/* ============================================================
   HelloDoc - shared inline form validation

   One small, dependency-free helper used by every form on the site:

     * each problem is shown beside the field it belongs to, and the
       message says what is wrong AND how to fix it;
     * a summary sits next to the submit button and is the live region
       announcements come from (role="alert");
     * invalid fields get aria-invalid + aria-describedby, so screen
       readers read the message with the field;
     * whatever the visitor already typed is preserved - values are
       never reset or rewritten, not even after a server error;
     * errors clear as soon as the field becomes valid, and a field is
       only flagged after it is left or after a submit attempt, so
       nobody is nagged mid-typing.

   Usage:

     const form = HelloDocForms.attach(document.querySelector(".signup-form"), {
       fields: [
         { id: "email", label: "Email address",
           rules: [HelloDocForms.rules.required("Email address", "enter the address you want to sign in with"),
                   HelloDocForms.rules.email()] },
       ],
       onSubmit: async (values, api) => {
         const res = await fetch("/api/auth/signup", { ... });
         if (!res.ok) { api.setFieldError("email", "…"); api.setSummary("…"); }
       },
     });

   Loaded with a plain <script> tag on the pages that own a form.
   ============================================================ */
(function (window, document) {
  "use strict";

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  /* ----------------------------------------------------------
     Rules. Each returns { valid: true } or { valid: false, message }.
     Every message names the problem and the fix, because it is read
     in place, next to the input, not in a dialog.
     ---------------------------------------------------------- */

  function required(label, howTo) {
    return function (value) {
      const filled = Array.isArray(value)
        ? value.length > 0
        : String(value === null || value === undefined ? "" : value).trim() !== "";
      if (filled) return { valid: true };
      return { valid: false, message: label + " is required — " + howTo + "." };
    };
  }

  function email() {
    return function (value) {
      const text = String(value || "").trim();
      if (!text) return { valid: true }; // emptiness is `required`'s job
      if (EMAIL_RE.test(text)) return { valid: true };
      return {
        valid: false,
        message: "Enter a valid email address, for example name@example.com.",
      };
    };
  }

  function minLength(min, label, howTo) {
    return function (value) {
      const text = String(value === null || value === undefined ? "" : value);
      if (!text) return { valid: true };
      if (text.length >= min) return { valid: true };
      return {
        valid: false,
        message:
          label + " must be at least " + min + " characters (you have " + text.length + "). " + howTo,
      };
    };
  }

  function dateISO(label) {
    return function (value) {
      const text = String(value || "").trim();
      if (!text) return { valid: true };
      if (DATE_RE.test(text)) return { valid: true };
      return {
        valid: false,
        message: label + " must look like 1998-04-27 — pick it from the calendar or type it as YYYY-MM-DD.",
      };
    };
  }

  function notFuture(label, howTo) {
    return function (value) {
      const text = String(value || "").trim();
      if (!text || !DATE_RE.test(text)) return { valid: true }; // handled by dateISO
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const chosen = new Date(text + "T00:00:00");
      if (chosen.getTime() <= today.getTime()) return { valid: true };
      return { valid: false, message: label + " cannot be in the future — " + howTo + "." };
    };
  }

  function oneOf(options, label, howTo, displayLabels) {
    const shown = displayLabels || options;
    return function (value) {
      const text = String(value || "").trim();
      if (text && options.indexOf(text) !== -1) return { valid: true };
      return {
        valid: false,
        message: label + " is required — " + howTo + " (" + shown.join(", ") + ").",
      };
    };
  }

  const rules = {
    required: required,
    email: email,
    minLength: minLength,
    dateISO: dateISO,
    notFuture: notFuture,
    oneOf: oneOf,
  };

  /* ----------------------------------------------------------
     Pure pass over the rules - no DOM, so it is easy to test.
     ---------------------------------------------------------- */

  function fieldKey(field) {
    return field.id || field.name;
  }

  function validateValues(fields, values) {
    const errors = [];
    (fields || []).forEach(function (field) {
      const key = fieldKey(field);
      const value = values ? values[key] : undefined;
      const fieldRules = field.rules || [];
      for (let i = 0; i < fieldRules.length; i += 1) {
        const result = fieldRules[i](value);
        if (result && result.valid === false) {
          errors.push({ field: key, label: field.label || key, message: result.message });
          break; // one problem per field is enough to act on
        }
      }
    });
    return { valid: errors.length === 0, errors: errors };
  }

  /* ----------------------------------------------------------
     DOM wiring
     ---------------------------------------------------------- */

  function controlsFor(form, field) {
    if (field.name && !field.id) {
      return Array.prototype.slice.call(form.querySelectorAll('[name="' + field.name + '"]'));
    }
    const control = form.querySelector("#" + fieldKey(field));
    return control ? [control] : [];
  }

  // Where the message is pinned: after the field's own block when it has one,
  // otherwise right after the control itself.
  function anchorFor(form, field, controls) {
    const control = controls[0];
    if (!control) return null;
    return control.closest(".form-grp, .form-group, .radio-group, .field, .field-group") || control;
  }

  function fieldValue(form, field, type) {
    const controls = controlsFor(form, field);
    if (!controls.length) return "";
    if (type === "radio") {
      const checked = controls.filter(function (el) { return el.checked; })[0];
      return checked ? checked.value : "";
    }
    if (type === "checkbox") return controls[0].checked;
    return controls[0].value;
  }

  // The summary links to the control itself, which is more reliable than the
  // key (a radio group is keyed by name, but the first radio has the id).
  function anchorIdOf(form, field) {
    const control = controlsFor(form, field)[0];
    return (control && control.id) || fieldKey(field);
  }

  function collectValues(form, fields) {
    const values = {};
    fields.forEach(function (field) {
      values[fieldKey(field)] = fieldValue(form, field, field.type);
    });
    return values;
  }

  function summaryElement(form, config) {
    let summary = null;
    if (config.summary) {
      summary = typeof config.summary === "string"
        ? document.querySelector(config.summary)
        : config.summary;
    }
    if (!summary) summary = form.querySelector("[data-form-summary]");
    if (!summary) {
      summary = document.createElement("div");
      summary.className = "form-summary";
      summary.setAttribute("data-form-summary", "");
      summary.setAttribute("role", "alert");
      summary.setAttribute("aria-live", "assertive");
      summary.setAttribute("aria-atomic", "true");
      summary.hidden = true;
      const submit = form.querySelector('button[type="submit"], input[type="submit"]');
      if (submit && submit.parentNode) submit.parentNode.insertBefore(summary, submit);
      else form.appendChild(summary);
    }
    return summary;
  }

  function attach(form, config) {
    if (!form) return null;
    config = config || {};
    const fields = config.fields || [];
    const summary = summaryElement(form, config);
    const seen = {}; // fields the visitor has already left or failed a submit on

    form.setAttribute("novalidate", "");

    function errorElement(field) {
      return form.querySelector('[data-field-error="' + fieldKey(field) + '"]');
    }

    // `errorId` is the id to attach (null when clearing). `purgeId` is the
    // field's error id we must drop even while clearing, otherwise the
    // attribute keeps pointing at a node that is no longer in the document.
    function describe(control, errorId, purgeId) {
      const drop = [errorId, purgeId].filter(Boolean);
      const existing = (control.getAttribute("aria-describedby") || "")
        .split(/\s+/)
        .filter(Boolean)
        .filter(function (id) { return drop.indexOf(id) === -1; });
      if (errorId) existing.push(errorId);
      if (existing.length) control.setAttribute("aria-describedby", existing.join(" "));
      else control.removeAttribute("aria-describedby");
    }

    // Some fields are two controls in one (the symptom field pairs a hidden
    // input with the visible tag box): both need the aria wiring.
    function markedControls(field) {
      const extra = (field.alsoMarks || []).map(function (id) {
        return form.querySelector("#" + id);
      }).filter(Boolean);
      return controlsFor(form, field).concat(extra);
    }

    function setFieldError(field, message) {
      const controls = markedControls(field);
      if (!controls.length) return;
      const key = fieldKey(field);
      const errorId = key + "-error";
      let node = errorElement(field);
      if (!node) {
        node = document.createElement("p");
        node.className = "field-error";
        node.id = errorId;
        node.setAttribute("data-field-error", key);
        const anchor = anchorFor(form, field, controls);
        if (anchor && anchor.parentNode) anchor.insertAdjacentElement("afterend", node);
        else return;
      }
      node.textContent = message;
      controls.forEach(function (control) {
        control.setAttribute("aria-invalid", "true");
        describe(control, errorId);
        const group = control.closest(".form-grp, .form-group, .field, .field-group");
        if (group) group.classList.add("has-error");
      });
    }

    function clearFieldError(field) {
      const controls = markedControls(field);
      const errorId = fieldKey(field) + "-error";
      const node = errorElement(field);
      if (node) node.remove();
      controls.forEach(function (control) {
        control.removeAttribute("aria-invalid");
        describe(control, null, errorId);
        const group = control.closest(".form-grp, .form-group, .field, .field-group");
        if (group) group.classList.remove("has-error");
      });
    }

    function currentErrors() {
      const errors = [];
      fields.forEach(function (field) {
        const node = errorElement(field);
        if (node && node.textContent) {
          errors.push({ field: fieldKey(field), label: field.label || fieldKey(field), message: node.textContent });
        }
      });
      return errors;
    }

    // The summary doubles as the live region. With inline errors it repeats
    // them (with links to the fields) next to the submit button; with only a
    // `title` it is a single form-level message, so nothing is said twice.
    function renderSummary(title, errors) {
      const list = errors || [];
      if (!list.length && !title) {
        summary.replaceChildren();
        summary.hidden = true;
        summary.removeAttribute("data-state");
        return;
      }
      summary.replaceChildren();
      const heading = document.createElement("p");
      heading.className = "form-summary__title";
      heading.textContent = title || (list.length === 1
        ? "Please fix 1 thing before continuing"
        : "Please fix " + list.length + " things before continuing");
      summary.appendChild(heading);
      if (!list.length) {
        summary.setAttribute("data-state", "error");
        summary.hidden = false;
        return;
      }
      const ul = document.createElement("ul");
      list.forEach(function (error) {
        const li = document.createElement("li");
        const field = fields.filter(function (item) {
          return fieldKey(item) === error.field;
        })[0];
        const target = field ? anchorIdOf(form, field) : "";
        if (target) {
          const link = document.createElement("a");
          link.href = "#" + target;
          link.textContent = error.label + ": " + error.message;
          li.appendChild(link);
        } else {
          li.textContent = error.label + ": " + error.message;
        }
        ul.appendChild(li);
      });
      summary.appendChild(ul);
      summary.setAttribute("data-state", "error");
      summary.hidden = false;
    }

    function validateField(field, show) {
      const result = validateValues([field], collectValues(form, [field]));
      if (result.valid) {
        clearFieldError(field);
        return true;
      }
      if (show) setFieldError(field, result.errors[0].message);
      return false;
    }

    function values() {
      return collectValues(form, fields);
    }

    function validateAll() {
      const errors = [];
      let firstInvalid = null;
      fields.forEach(function (field) {
        const key = fieldKey(field);
        seen[key] = true;
        const result = validateValues([field], collectValues(form, [field]));
        if (result.valid) {
          clearFieldError(field);
        } else {
          setFieldError(field, result.errors[0].message);
          errors.push(result.errors[0]);
          if (!firstInvalid) firstInvalid = controlsFor(form, field)[0] || null;
        }
      });
      renderSummary(null, errors);
      if (firstInvalid && typeof firstInvalid.focus === "function") firstInvalid.focus();
      return errors.length === 0;
    }

    function focusFirstInvalid() {
      const invalid = form.querySelector('[aria-invalid="true"]');
      if (invalid && typeof invalid.focus === "function") invalid.focus();
    }

    fields.forEach(function (field) {
      const key = fieldKey(field);
      controlsFor(form, field).forEach(function (control) {
        control.addEventListener("blur", function () {
          seen[key] = true;
          validateField(field, true);
          renderSummary(null, currentErrors());
        });
        ["input", "change"].forEach(function (type) {
          control.addEventListener(type, function () {
            if (!seen[key]) return; // wait until they leave the field once
            validateField(field, true);
            renderSummary(null, currentErrors());
          });
        });
      });
    });

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (!validateAll()) return;
      // With no callback the validated form is submitted natively (the symptom
      // checker posts to /predict); form.submit() avoids re-entering this handler.
      if (typeof config.onSubmit !== "function") {
        form.submit();
        return;
      }
      try {
        await config.onSubmit(values(), api);
      } catch (error) {
        renderSummary(
          "Something went wrong on our side — we could not send your details. Check your connection and try again.",
          []
        );
      }
    });

    const api = {
      validateAll: validateAll,
      values: values,
      // Server-side problems are mapped onto the field they belong to, so the
      // visitor sees them in the same place as the client-side ones.
      setFieldError: function (key, message) {
        const field = fields.filter(function (item) { return fieldKey(item) === key; })[0];
        if (!field) {
          renderSummary(message, []);
          return;
        }
        setFieldError(field, message);
        renderSummary(null, currentErrors());
      },
      clearFieldError: function (key) {
        const field = fields.filter(function (item) { return fieldKey(item) === key; })[0];
        if (field) clearFieldError(field);
        renderSummary(null, currentErrors());
      },
      // A message about the whole form, not one field (server outages, etc.).
      setSummary: function (message) {
        renderSummary(message, []);
      },
      // Non-error feedback (for example "account created") still uses the live
      // region next to the submit button, so it is announced too.
      setNotice: function (message) {
        summary.replaceChildren();
        const notice = document.createElement("p");
        notice.className = "form-summary__title";
        notice.textContent = message;
        summary.appendChild(notice);
        summary.setAttribute("data-state", "success");
        summary.hidden = false;
      },
      clearSummary: function () { renderSummary(null, []); },
      setBusy: function (busy) {
        const submit = form.querySelector('button[type="submit"], input[type="submit"]');
        if (!submit) return;
        submit.disabled = !!busy;
        form.setAttribute("aria-busy", busy ? "true" : "false");
        if (busy) {
          // Keep the original label so it can be restored after a failure.
          if (!submit.hasAttribute("data-label")) {
            submit.setAttribute("data-label", submit.textContent);
          }
          submit.textContent = submit.getAttribute("data-label-busy") || "Please wait…";
        } else if (submit.hasAttribute("data-label")) {
          submit.textContent = submit.getAttribute("data-label");
          submit.removeAttribute("data-label");
        }
      },
      focusFirstInvalid: focusFirstInvalid,
      summary: summary,
      form: form,
    };

    return api;
  }

  window.HelloDocForms = {
    attach: attach,
    rules: rules,
    validateValues: validateValues,
  };
})(typeof window !== "undefined" ? window : this, typeof document !== "undefined" ? document : null);
