"use strict";
/*
 * Exercises the rule layer of Scripts/form-validation.js (the part that runs
 * with or without a DOM) and prints a JSON report.
 *
 * Usage: node tests/form_validation_rules.js
 * Exit code is non-zero when any case fails.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const modulePath = path.join(__dirname, "..", "Scripts", "form-validation.js");
const code = fs.readFileSync(modulePath, "utf8");

// The module only touches document/window inside attach(), so the rule tests
// need nothing more than these names to exist at load time.
const sandbox = { window: {}, document: {}, console: console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "form-validation.js" });

const forms = sandbox.window.HelloDocForms;
if (!forms || !forms.rules || typeof forms.validateValues !== "function") {
  console.error("HelloDocForms did not expose rules/validateValues");
  process.exit(2);
}

const { rules, validateValues } = forms;
const cases = [];

function check(name, condition, detail) {
  cases.push({ name: name, pass: !!condition, detail: detail === undefined ? null : detail });
}

// A message is only useful if it says what is wrong AND how to fix it.
function actionable(message) {
  if (typeof message !== "string" || message.length < 20) return false;
  const saysWhat = /required|must|valid|cannot|isn't|is not/i.test(message);
  const saysHow = /enter|pick|select|use|choose|try|add|check|type/i.test(message);
  return saysWhat && saysHow;
}

function resultOf(rule, value) {
  const outcome = rule(value);
  return outcome && outcome.valid === false ? outcome.message : null;
}

/* ---------- required ---------- */
const requiredEmail = rules.required("Email address", "enter the address you want to sign in with");
check("required: empty string is invalid", resultOf(requiredEmail, "") !== null);
check("required: whitespace only is invalid", resultOf(requiredEmail, "   ") !== null);
check("required: undefined is invalid", resultOf(requiredEmail, undefined) !== null);
check("required: filled value is valid", resultOf(requiredEmail, "a@b.com") === null);
check("required: empty array is invalid", resultOf(rules.required("Sex", "select one of the options"), []) !== null);
check("required: message explains the fix", actionable(resultOf(requiredEmail, "")), resultOf(requiredEmail, ""));

/* ---------- email ---------- */
check("email: missing @ is invalid", resultOf(rules.email(), "nope") !== null);
check("email: missing domain is invalid", resultOf(rules.email(), "nope@") !== null);
check("email: spaces are invalid", resultOf(rules.email(), "a b@c.com") !== null);
check("email: normal address is valid", resultOf(rules.email(), "name@example.com") === null);
check("email: empty is left to required", resultOf(rules.email(), "") === null);
check("email: message names an example", /name@example\.com/.test(resultOf(rules.email(), "nope") || ""), resultOf(rules.email(), "nope"));

/* ---------- minLength ---------- */
const passwordRule = rules.minLength(8, "Password", "Try a short phrase you can remember.");
check("minLength: short value is invalid", resultOf(passwordRule, "abc") !== null);
check("minLength: message reports the current length", /you have 3/.test(resultOf(passwordRule, "abc") || ""), resultOf(passwordRule, "abc"));
check("minLength: boundary value is valid", resultOf(passwordRule, "12345678") === null);
check("minLength: empty is left to required", resultOf(passwordRule, "") === null);

/* ---------- dateISO / notFuture ---------- */
const dobISO = rules.dateISO("Date of birth");
const dobPast = rules.notFuture("Date of birth", "choose the date you were born");
check("dateISO: slashes are invalid", resultOf(dobISO, "27/04/1998") !== null);
check("dateISO: ISO date is valid", resultOf(dobISO, "1998-04-27") === null);
check("dateISO: message shows the expected shape", /1998-04-27/.test(resultOf(dobISO, "27/04/1998") || ""));
check("notFuture: tomorrow-ish date is invalid", resultOf(dobPast, "2999-01-01") !== null);
check("notFuture: past date is valid", resultOf(dobPast, "1990-01-01") === null);
check("notFuture: bad format is left to dateISO", resultOf(dobPast, "nonsense") === null);

/* ---------- oneOf ---------- */
const sexRule = rules.oneOf(["male", "female", "other"], "Sex", "select one of the options", ["Male", "Female", "Others"]);
check("oneOf: empty is invalid", resultOf(sexRule, "") !== null);
check("oneOf: unknown value is invalid", resultOf(sexRule, "yes") !== null);
check("oneOf: member value is valid", resultOf(sexRule, "female") === null);
check("oneOf: message lists the options", /Male, Female, Others/.test(resultOf(sexRule, "") || ""), resultOf(sexRule, ""));

/* ---------- pure pass over several fields ---------- */
const fields = [
  { id: "email", label: "Email address", rules: [requiredEmail, rules.email()] },
  { id: "password", label: "Password", rules: [rules.required("Password", "enter your password"), passwordRule] },
];
const bad = validateValues(fields, { email: "nope", password: "" });
check("validateValues: reports one error per field", bad.valid === false && bad.errors.length === 2, bad.errors);
check("validateValues: keeps the field keys", bad.errors.map((e) => e.field).join(",") === "email,password");
check("validateValues: carries the messages", bad.errors.every((e) => actionable(e.message)));
check("validateValues: stops at the first problem per field", bad.errors.filter((e) => e.field === "email").length === 1);
const good = validateValues(fields, { email: "name@example.com", password: "correct horse" });
check("validateValues: valid values produce no errors", good.valid === true && good.errors.length === 0);
check("validateValues: missing rules never crash", validateValues([{ id: "x" }], { x: "" }).valid === true);

/* ---------------------------------------------------------------
   The real page configurations

   signup.js and login.js build their field lists at DOMContentLoaded,
   so they are run here against a stub DOM with attach() intercepted.
   That way the messages asserted below are the ones visitors will
   actually read, not a copy of them.
   --------------------------------------------------------------- */

function fakeElement() {
  const element = {
    style: {},
    hidden: false,
    disabled: false,
    textContent: "",
    value: "",
    focus() {},
    addEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    hasAttribute() { return false; },
    querySelector() { return fakeElement(); },
    querySelectorAll() { return []; },
    closest() { return null; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  };
  return element;
}

function capturePageConfig(scriptRelativePath) {
  const captured = [];
  const ready = [];
  const scope = {
    console: console,
    // login.js also touches window-level listeners and window.location
    addEventListener() {},
    removeEventListener() {},
    location: { href: "" },
    sessionStorage: { setItem() {}, getItem() { return null; } },
    fetch() {
      return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });
    },
    setTimeout() { return 0; },
    document: {
      addEventListener(type, handler) {
        if (type === "DOMContentLoaded") ready.push(handler);
      },
      getElementById() { return fakeElement(); },
      querySelector() { return fakeElement(); },
      querySelectorAll() { return []; },
      createElement() { return fakeElement(); },
    },
  };
  scope.window = scope;
  scope.HelloDocForms = {
    rules: rules,
    validateValues: validateValues,
    attach(form, config) {
      captured.push(config);
      return {
        setBusy() {}, setNotice() {}, setSummary() {}, clearSummary() {},
        setFieldError() {}, clearFieldError() {}, validateAll() { return true; },
      };
    },
  };

  vm.createContext(scope);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", scriptRelativePath), "utf8"),
    scope,
    { filename: path.basename(scriptRelativePath) }
  );
  ready.forEach((handler) => handler());
  return captured[0] || null;
}

// Per page, because the rules differ: signup creates a password (so it has a
// length rule), while login can only check that one was typed - whether it is
// right is the server's call.
const PAGE_CONFIGS = [
  {
    label: "signup.js",
    script: "Scripts/signup.js",
    bad: {
      firstName: ["", "   "],
      lastName: [""],
      email: ["", "not-an-email", "missing@domain"],
      password: ["", "abc"],
      dob: ["", "27/04/1998", "2999-01-01"],
      sex: ["", "yes"],
    },
    good: {
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      password: "correct horse",
      dob: "1990-01-01",
      sex: "female",
    },
  },
  {
    label: "login.js",
    script: "Scripts/login.js",
    bad: { email: ["", "not-an-email"], password: [""] },
    good: { email: "ada@example.com", password: "hunter2" },
  },
];

PAGE_CONFIGS.forEach((page) => {
  const config = capturePageConfig(page.script);
  check(page.label + ": attaches validation to the form", config && Array.isArray(config.fields) && config.fields.length > 0);
  check(page.label + ": has a submit handler", config && typeof config.onSubmit === "function");
  if (!config) return;

  config.fields.forEach((field) => {
    const key = field.id || field.name;
    const bads = (page.bad && page.bad[key]) || [""];
    bads.forEach((bad) => {
      const outcome = validateValues([field], { [key]: bad });
      check(
        page.label + " [" + key + "] rejects " + JSON.stringify(bad),
        outcome.valid === false,
        outcome.errors
      );
      if (!outcome.valid) {
        check(
          page.label + " [" + key + "] message explains the fix for " + JSON.stringify(bad),
          actionable(outcome.errors[0].message),
          outcome.errors[0].message
        );
      }
    });
    const good = page.good ? page.good[key] : undefined;
    if (good !== undefined) {
      const outcome = validateValues([field], { [key]: good });
      check(page.label + " [" + key + "] accepts " + JSON.stringify(good), outcome.valid === true, outcome.errors);
    }
  });
});

const failed = cases.filter((c) => !c.pass);
process.stdout.write(JSON.stringify({ total: cases.length, failed: failed.length, cases: cases }));
process.exit(failed.length === 0 ? 0 : 1);
