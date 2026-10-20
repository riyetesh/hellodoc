import importlib.util
from pathlib import Path

import pytest


@pytest.fixture(scope='module')
def model():
    root = Path(__file__).resolve().parents[1] / 'Algo'
    spec = importlib.util.spec_from_file_location('clinical_model_under_test', root / 'main.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_order_and_supported_class(model):
    columns = list(model.svc.feature_names_in_)
    assert len(columns) == len(model.symptoms_dict) == 132
    assert all(columns[index] == name for name, index in model.symptoms_dict.items())
    assert set(int(value) for value in model.svc.classes_) == set(model.diseases_list)
    assert model.get_predicted_value(['itching']) in model.diseases_list.values()


def test_invalid_symptom_is_rejected(model):
    with pytest.raises(ValueError):
        model.get_predicted_value(['unknown symptom'])
    with pytest.raises(ValueError):
        model.get_predicted_value([])


def test_internal_assess_returns_guidance_and_only_model_features(model, monkeypatch):
    monkeypatch.setenv('PREDICTION_INTERNAL_TOKEN', 'test-token')
    client = model.app.test_client()
    assert client.post('/internal/assess', json={'symptoms': ['itching']}).status_code == 403
    headers = {'X-Internal-Token': 'test-token'}
    assert client.post('/internal/assess', json={'symptoms': ['unknown']}, headers=headers).status_code == 422
    assert client.post('/internal/assess', json={'symptoms': []}, headers=headers).status_code == 422

    response = client.post('/internal/assess', json={'symptoms': ['itching', 'skin_rash']}, headers=headers)
    assert response.status_code == 200
    body = response.json
    assert body['output'] in model.diseases_list.values()
    assert body['modelVersion'] == model.MODEL_VERSION
    # The SVC is not probability-calibrated, so no score may be reported.
    assert body['confidenceSupported'] is False
    assert body['confidence'] is None
    assert isinstance(body['description'], str)
    for key in ('precautions', 'medications', 'diet', 'workout'):
        assert isinstance(body[key], list)
        assert all(isinstance(item, str) and item.strip() for item in body[key])
    # No patient identifiers or notes are accepted, echoed or returned.
    assert not {'patientId', 'patientName', 'clinicalNote', 'appointmentId'} & set(body)


def test_internal_endpoint_rejects_unauthorized_and_invalid(model, monkeypatch):
    monkeypatch.setenv('PREDICTION_INTERNAL_TOKEN', 'test-token')
    client = model.app.test_client()
    assert client.post('/internal/predict', json={'symptoms': ['itching']}).status_code == 403
    headers = {'X-Internal-Token': 'test-token'}
    assert client.post('/internal/predict', json={'symptoms': ['unknown']}, headers=headers).status_code == 422
    response = client.post('/internal/predict', json={'symptoms': ['itching']}, headers=headers)
    assert response.status_code == 200
    assert response.json['output'] in model.diseases_list.values()
    assert response.json['modelVersion'] == model.MODEL_VERSION
