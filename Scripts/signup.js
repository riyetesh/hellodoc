// Signup form handling for the root signup page.
//
// Validation lives in Scripts/form-validation.js: every problem is shown next
// to the field it belongs to with an explanation of how to fix it, and the
// summary beside the Continue button is the live region for announcements.
// Nothing typed is ever cleared - not even when the server rejects a value.
document.addEventListener("DOMContentLoaded", function () {
  const form = document.querySelector(".signup-form");
  if (!form || !window.HelloDocForms) return;

  const { attach, rules } = window.HelloDocForms;

  // The API answers with human-readable reasons; map the ones we know back
  // onto the field they are about so they appear in the right place.
  const SERVER_FIELD_ERRORS = [
    [/already exists/i, "email", "That email already has a HelloDoc account — log in instead, or use a different address."],
    [/valid email/i, "email", "Enter a valid email address, for example name@example.com."],
    [/password must be at least/i, "password", "Password must be at least 8 characters — try a short phrase you can remember."],
    [/date of birth/i, "dob", "Date of birth must look like 1998-04-27 (YYYY-MM-DD)."],
    [/invalid value for sex/i, "sex", "Sex is required — select Male, Female or Others."],
    [/all fields are required/i, "firstName", "Fill in every field, then press Continue again."],
  ];

  attach(form, {
    fields: [
      {
        id: "firstName",
        label: "First name",
        rules: [rules.required("First name", "enter the name you want on your account")],
      },
      {
        id: "lastName",
        label: "Last name",
        rules: [rules.required("Last name", "enter your family name")],
      },
      {
        id: "email",
        label: "Email address",
        rules: [
          rules.required("Email address", "enter the address you want to sign in with"),
          rules.email(),
        ],
      },
      {
        id: "password",
        label: "Password",
        rules: [
          rules.required("Password", "choose a password with at least 8 characters"),
          rules.minLength(8, "Password", "Try a short phrase you can remember, or add a few more characters."),
        ],
      },
      {
        id: "dob",
        label: "Date of birth",
        rules: [
          rules.required("Date of birth", "pick the date you were born"),
          rules.dateISO("Date of birth"),
          rules.notFuture("Date of birth", "choose the date you were born"),
        ],
      },
      {
        name: "sex",
        type: "radio",
        label: "Sex",
        rules: [rules.oneOf(["male", "female", "other"], "Sex", "select one of the options", ["Male", "Female", "Others"])],
      },
    ],

    onSubmit: async function (values, api) {
      let done = false;
      api.setBusy(true);
      try {
        // Same-origin relative URL: works locally and behind the Vercel rewrite to the backend service.
        const response = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        });
        const data = await response.json().catch(function () {
          return {};
        });

        if (response.ok) {
          // Stay disabled so the account is not created twice while the
          // confirmation is announced and the redirect starts.
          done = true;
          api.setNotice("Account created — taking you to the home page to log in.");
          window.setTimeout(function () {
            window.location.href = "index.html";
          }, 1200);
          return;
        }

        const message = data.message || "We could not create your account. Please try again.";
        const mapped = SERVER_FIELD_ERRORS.filter(function (entry) {
          return entry[0].test(message);
        })[0];

        if (response.status === 503) {
          api.setSummary("The service is unavailable right now. Please try again in a few minutes.");
          return;
        }
        if (mapped) api.setFieldError(mapped[1], mapped[2]);
        else api.setSummary(message);
      } catch (error) {
        console.error("Signup request failed");
        api.setSummary("We could not reach the server. Check your connection and try again.");
      } finally {
        if (!done) api.setBusy(false);
      }
    },
  });
});
