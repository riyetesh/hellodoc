from flask import Flask, request, render_template, jsonify  # Import jsonify
import numpy as np
import pandas as pd
import pickle
from pathlib import Path
import json
import os
import secrets
import hashlib
import hmac
import urllib.error
import urllib.request
from datetime import datetime, timezone
from flask import    redirect, url_for, flash, session
from flask_sqlalchemy import SQLAlchemy
from flask_bcrypt import Bcrypt
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user


# Disclaimer shown on both the results page and the downloadable report.
# It is part of the single report object so page and PDF cannot drift apart.
REPORT_DISCLAIMER = (
    "Experimental prototype: this symptom guidance is a preliminary machine-"
    "learning suggestion, not a confirmed diagnosis, and it has not been "
    "reviewed by a clinician. Always consult a qualified healthcare "
    "professional about your symptoms."
)


# flask app
app = Flask(__name__)



# Resolve data/model paths relative to this file, not Vercel's working directory.
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "datasets"
MODEL_DIR = BASE_DIR / "models"

# Load datasets
sym_des = pd.read_csv(DATA_DIR / "symtoms_df.csv")
precautions = pd.read_csv(DATA_DIR / "precautions_df.csv")
workout = pd.read_csv(DATA_DIR / "workout_df.csv")
description = pd.read_csv(DATA_DIR / "description.csv")
medications = pd.read_csv(DATA_DIR / "new_medications.csv")
diets = pd.read_csv(DATA_DIR / "new_diets.csv")

# Load model
with (MODEL_DIR / "svc.pkl").open("rb") as model_file:
    svc = pickle.load(model_file)


#============================================================
# custome and helping functions
#==========================helper funtions================
def helper(dis):
    desc = description[description['Disease'] == dis]['Description']
    desc = " ".join([w for w in desc])

    pre = precautions[precautions['Disease'] == dis][['Precaution_1', 'Precaution_2', 'Precaution_3', 'Precaution_4']]
    pre = [col for col in pre.values]

    med = medications[medications['Disease'] == dis]['Medication']
    med = [med for med in med.values]

    die = diets[diets['Disease'] == dis]['Diet']
    die = [die for die in die.values]

    wrkout = workout[workout['disease'] == dis]['workout']


    return desc,pre,med,die,wrkout

symptoms_dict = {'itching': 0, 'skin_rash': 1, 'nodal_skin_eruptions': 2, 'continuous_sneezing': 3, 'shivering': 4, 'chills': 5, 'joint_pain': 6, 'stomach_pain': 7, 'acidity': 8, 'ulcers_on_tongue': 9, 'muscle_wasting': 10, 'vomiting': 11, 'burning_micturition': 12, 'spotting_ urination': 13, 'fatigue': 14, 'weight_gain': 15, 'anxiety': 16, 'cold_hands_and_feets': 17, 'mood_swings': 18, 'weight_loss': 19, 'restlessness': 20, 'lethargy': 21, 'patches_in_throat': 22, 'irregular_sugar_level': 23, 'cough': 24, 'high_fever': 25, 'sunken_eyes': 26, 'breathlessness': 27, 'sweating': 28, 'dehydration': 29, 'indigestion': 30, 'headache': 31, 'yellowish_skin': 32, 'dark_urine': 33, 'nausea': 34, 'loss_of_appetite': 35, 'pain_behind_the_eyes': 36, 'back_pain': 37, 'constipation': 38, 'abdominal_pain': 39, 'diarrhoea': 40, 'mild_fever': 41, 'yellow_urine': 42, 'yellowing_of_eyes': 43, 'acute_liver_failure': 44, 'fluid_overload': 45, 'swelling_of_stomach': 46, 'swelled_lymph_nodes': 47, 'malaise': 48, 'blurred_and_distorted_vision': 49, 'phlegm': 50, 'throat_irritation': 51, 'redness_of_eyes': 52, 'sinus_pressure': 53, 'runny_nose': 54, 'congestion': 55, 'chest_pain': 56, 'weakness_in_limbs': 57, 'fast_heart_rate': 58, 'pain_during_bowel_movements': 59, 'pain_in_anal_region': 60, 'bloody_stool': 61, 'irritation_in_anus': 62, 'neck_pain': 63, 'dizziness': 64, 'cramps': 65, 'bruising': 66, 'obesity': 67, 'swollen_legs': 68, 'swollen_blood_vessels': 69, 'puffy_face_and_eyes': 70, 'enlarged_thyroid': 71, 'brittle_nails': 72, 'swollen_extremeties': 73, 'excessive_hunger': 74, 'extra_marital_contacts': 75, 'drying_and_tingling_lips': 76, 'slurred_speech': 77, 'knee_pain': 78, 'hip_joint_pain': 79, 'muscle_weakness': 80, 'stiff_neck': 81, 'swelling_joints': 82, 'movement_stiffness': 83, 'spinning_movements': 84, 'loss_of_balance': 85, 'unsteadiness': 86, 'weakness_of_one_body_side': 87, 'loss_of_smell': 88, 'bladder_discomfort': 89, 'foul_smell_of urine': 90, 'continuous_feel_of_urine': 91, 'passage_of_gases': 92, 'internal_itching': 93, 'toxic_look_(typhos)': 94, 'depression': 95, 'irritability': 96, 'muscle_pain': 97, 'altered_sensorium': 98, 'red_spots_over_body': 99, 'belly_pain': 100, 'abnormal_menstruation': 101, 'dischromic _patches': 102, 'watering_from_eyes': 103, 'increased_appetite': 104, 'polyuria': 105, 'family_history': 106, 'mucoid_sputum': 107, 'rusty_sputum': 108, 'lack_of_concentration': 109, 'visual_disturbances': 110, 'receiving_blood_transfusion': 111, 'receiving_unsterile_injections': 112, 'coma': 113, 'stomach_bleeding': 114, 'distention_of_abdomen': 115, 'history_of_alcohol_consumption': 116, 'fluid_overload.1': 117, 'blood_in_sputum': 118, 'prominent_veins_on_calf': 119, 'palpitations': 120, 'painful_walking': 121, 'pus_filled_pimples': 122, 'blackheads': 123, 'scurring': 124, 'skin_peeling': 125, 'silver_like_dusting': 126, 'small_dents_in_nails': 127, 'inflammatory_nails': 128, 'blister': 129, 'red_sore_around_nose': 130, 'yellow_crust_ooze': 131}
diseases_list = {15: 'Fungal infection', 4: 'Allergy', 16: 'GERD', 9: 'Chronic cholestasis', 14: 'Drug Reaction', 33: 'Peptic ulcer disease', 1: 'AIDS', 12: 'Diabetes ', 17: 'Gastroenteritis', 6: 'Bronchial Asthma', 23: 'Hypertension ', 30: 'Migraine', 7: 'Cervical spondylosis', 32: 'Paralysis (brain hemorrhage)', 28: 'Jaundice', 29: 'Malaria', 8: 'Chicken pox', 11: 'Dengue', 37: 'Typhoid', 40: 'hepatitis A', 19: 'Hepatitis B', 20: 'Hepatitis C', 21: 'Hepatitis D', 22: 'Hepatitis E', 3: 'Alcoholic hepatitis', 36: 'Tuberculosis', 10: 'Common Cold', 34: 'Pneumonia', 13: 'Dimorphic hemmorhoids(piles)', 18: 'Heart attack', 39: 'Varicose veins', 26: 'Hypothyroidism', 24: 'Hyperthyroidism', 25: 'Hypoglycemia', 31: 'Osteoarthristis', 5: 'Arthritis', 0: '(vertigo) Paroymsal  Positional Vertigo', 2: 'Acne', 38: 'Urinary tract infection', 35: 'Psoriasis', 27: 'Impetigo'}

# Model Prediction functionf
def get_predicted_value(patient_symptoms):
    if not patient_symptoms or any(item not in symptoms_dict for item in patient_symptoms):
        raise ValueError("Unknown or missing model symptom")
    columns = list(svc.feature_names_in_)
    if len(columns) != len(symptoms_dict) or any(columns[i] != name for name, i in symptoms_dict.items()):
        raise RuntimeError("Model feature order differs from symptom dictionary")
    input_vector = pd.DataFrame([[int(name in patient_symptoms) for name in columns]], columns=columns)
    return diseases_list[int(svc.predict(input_vector)[0])]



#============================================================================
# Authenticated identity (trusted server-side only)
#============================================================================
# The Express backend owns authentication: it verifies the signed session
# cookie and is the only component with the user records.
# This service therefore never trusts an id/email from the query string, a
# form field or client-side JavaScript. It forwards the caller's own
# credentials to the backend and uses the identity the backend validates.
#
# BACKEND_ORIGIN must point at the backend service (local default:
# http://127.0.0.1:5000). On Vercel set it to the public site origin, because
# /api/* is rewritten to the Express service there. If it is unreachable the
# caller is treated as anonymous, which only hides the optional patient block.
BACKEND_ORIGIN = (os.environ.get("BACKEND_ORIGIN") or "http://127.0.0.1:5000").rstrip("/")
BACKEND_TIMEOUT_SECONDS = float(os.environ.get("BACKEND_TIMEOUT_SECONDS", "2.0"))

# Only these fields may ever reach the results page / PDF. Anything else the
# backend might return (dob, sex, password hashes, internal ids) is dropped.
PATIENT_FIELDS = ("firstName", "lastName", "email")


def _same_identity(left, right):
    """True only when both values identify the same account."""
    if left is None or right is None:
        return False
    return str(left).strip() == str(right).strip()


def _sanitize_patient(authenticated_user_id, backend_user):
    """Return a verified patient dict, or None when nothing verified is available.

    A profile is trusted only when the backend returned it for the very same
    identity the backend authenticated. Only individually present fields are
    kept, so a partial profile never gains invented values.
    """
    if authenticated_user_id is None or not isinstance(backend_user, dict):
        return None

    record_id = backend_user.get("id", backend_user.get("userId"))
    if not _same_identity(record_id, authenticated_user_id):
        # The record does not belong to the authenticated caller: refuse it.
        return None

    patient = {}
    for field in PATIENT_FIELDS:
        value = backend_user.get(field)
        # Only non-empty strings are kept. Nothing is coerced, defaulted or
        # guessed for a field the backend did not actually supply.
        if isinstance(value, str) and value.strip():
            patient[field] = value.strip()

    return patient or None


def fetch_verified_user(forward_headers=None):
    """Resolve the authenticated user via the backend auth service.

    Returns (user_id, profile_dict) or (None, None) when the caller is not
    authenticated / the backend cannot be reached. Never logs credentials,
    profile data or symptoms.
    """
    if forward_headers is None:
        forward_headers = request.headers

    headers = {"Accept": "application/json"}
    cookie = forward_headers.get("Cookie")
    if cookie:
        headers["Cookie"] = cookie

    # Nothing to authenticate with: skip the round trip entirely.
    if "Cookie" not in headers:
        return None, None

    req = urllib.request.Request(f"{BACKEND_ORIGIN}/api/auth/profile", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=BACKEND_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError, TimeoutError):
        # Unauthenticated or auth service unavailable: treat as anonymous.
        return None, None

    if not isinstance(payload, dict):
        return None, None

    user_id = payload.get("userId", payload.get("id"))
    if user_id is None:
        return None, None
    return user_id, payload


def _clean_items(values):
    """Normalise dataset values into a flat list of real, non-empty strings.

    The datasets arrive as numpy arrays / pandas Series that mix real entries
    with NaN padding, and the 2D precaution rows come wrapped in a list. This
    flattens them and drops NaN/None so nothing like "nan" is ever presented to
    a patient as guidance.
    """
    items = []
    if values is None:
        return items
    try:
        iterable = list(values)
    except TypeError:
        iterable = [values]
    for item in iterable:
        if isinstance(item, (list, tuple, np.ndarray)):
            items.extend(_clean_items(item))
            continue
        text = str(item).strip()
        if not text or text.lower() in ("nan", "none", "null"):
            continue
        items.append(text)
    return items


def build_report(predicted_disease, dis_des, precautions, medications, diet, workout,
                 authenticated_user_id=None, backend_user=None, generated_at=None):
    """Build the single validated report object used by BOTH the page and the PDF.

    The template and the client-side PDF generator render from this exact
    dictionary (serialised once), so they cannot disagree about what was
    predicted or whose profile is shown.
    """
    return {
        "patient": _sanitize_patient(authenticated_user_id, backend_user),
        "prediction": {"disease": predicted_disease},
        "description": dis_des or "",
        "precautions": _clean_items(precautions),
        "medications": _clean_items(medications),
        "diet": _clean_items(diet),
        "workout": _clean_items(workout),
        "generatedAt": generated_at or datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "disclaimer": REPORT_DISCLAIMER,
    }


# creating routes========================================

# Sessions/flash need a secret key; set SECRET_KEY in production.
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY") or secrets.token_hex(32)

# Home Route (Landing Page)
@app.route("/")
def index():
    return jsonify(message='The public symptom checker is unavailable.'), 403

MODEL_VERSION = hashlib.sha256((MODEL_DIR / "svc.pkl").read_bytes()).hexdigest()[:16]

def _internal_authorized():
    token = os.environ.get('PREDICTION_INTERNAL_TOKEN')
    supplied = request.headers.get('X-Internal-Token', '')
    return bool(token and hmac.compare_digest(token, supplied))


@app.get('/internal/symptoms')
def internal_symptoms():
    if not _internal_authorized():
        return jsonify(message='Forbidden'), 403
    return jsonify(symptoms=list(symptoms_dict))


@app.post('/internal/predict')
def internal_predict():
    if not _internal_authorized():
        return jsonify(message='Forbidden'), 403
    body = request.get_json(silent=True) or {}
    symptoms = body.get('symptoms')
    if not isinstance(symptoms, list) or not symptoms or len(symptoms) > len(symptoms_dict) or any(
        not isinstance(item, str) or item not in symptoms_dict for item in symptoms
    ):
        return jsonify(message='Unknown or missing model symptom'), 422
    try:
        return jsonify(output=get_predicted_value(symptoms), modelVersion=MODEL_VERSION)
    except (ValueError, RuntimeError):
        app.logger.exception('Model feature mismatch')
        return jsonify(message='Model unavailable'), 503

# Prediction Route (Separate Results Page)
@app.route('/predict', methods=['GET', 'POST'])
def predict():
    return jsonify(message='Symptom checks are available only in the approved doctor workflow.'), 403


if __name__ == '__main__':
    # Port 5001 keeps this private model server separate from the Node backend
    # (which owns 5000). The backend calls only token-protected /internal routes.
    # FLASK_PORT (not PORT) is used deliberately: generic PORT env vars are
    # often injected by hosts and would break the proxy target.
    #
    # When backend/server.js auto-starts this process it sets FLASK_NO_RELOADER=1
    # so we run as a single, cleanly-killable process (the Werkzeug reloader
    # otherwise forks a grandchild that can survive the parent being stopped).
    _debug = os.environ.get("FLASK_DEBUG", "1") == "1"
    _reloader = os.environ.get("FLASK_NO_RELOADER", "0") != "1"
    app.run(
        debug=_debug,
        use_reloader=_reloader,
        port=int(os.environ.get("FLASK_PORT", 5001)),
    )