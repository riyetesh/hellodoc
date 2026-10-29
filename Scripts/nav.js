/* ============================================================
   HelloDoc - Shared navbar behavior
   Loaded by every page so the navbar acts the same everywhere:
   menu button, scroll shadow, live appointments badge,
   the logged-in user chip (fetched from the backend session), and the
   current-page highlight for the shared navbar.
   Requires app.css for markup/classes. Optionally uses
   appointments.js for the badge count.
   ============================================================ */

(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  // The patient area's primary navigation, defined once here instead of being
  // copied into every patient page. Account settings and sign-out deliberately
  // live in the account menu, never among the health destinations.
  const PATIENT_LINKS = [
    { href: "patient.html", label: "Dashboard" },
    { href: "dashboard.html", label: "Find a doctor" },
    { href: "appointments.html", label: "My appointments", badge: true },
    { href: "records.html", label: "Health records" },
    { href: "walkin.html", label: "Walk-in queue" },
  ];

  const ROLE_LINKS = {
    patient: [{ href: "account.html", label: "Account and settings" }],
    doctor: [{ href: "doctor.html", label: "Doctor workspace" }],
    admin: [{ href: "/admin", label: "Administration" }],
  };

  function initPatientNav() {
    if (!document.body || !document.body.classList.contains("patient-page")) return;
    const links = $("#navLinks");
    if (!links) return;
    links.dataset.nav = "patient";
    links.replaceChildren(
      ...PATIENT_LINKS.map(({ href, label, badge }) => {
        const item = document.createElement("li");
        const anchor = document.createElement("a");
        anchor.className = "nav-link";
        anchor.href = href;
        anchor.textContent = label;
        if (badge) {
          const count = document.createElement("span");
          count.className = "nav-badge";
          count.dataset.apptBadge = "";
          count.textContent = "0";
          anchor.append(count);
        }
        item.append(anchor);
        return item;
      })
    );
  }

  // Below the collapse breakpoint the canonical navbar becomes a menu behind a
  // conventional menu button, so the logo stays a plain home link at every
  // width. The breakpoint must match Styles/app.css (1200px).
  const mobileNav = window.matchMedia("(max-width: 1200px)");

  function initMenu() {
    const toggle = $(".nav-toggle");
    const links = $("#navLinks");
    const actions = $("#navActions");
    if (!toggle || !links || !actions) return;

    function isOpen() {
      return toggle.getAttribute("aria-expanded") === "true";
    }

    function setOpen(open) {
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute(
        "aria-label",
        open ? "Close navigation menu" : "Open navigation menu"
      );
      links.classList.toggle("open", open);
      actions.classList.toggle("open", open);
    }

    toggle.addEventListener("click", () => setOpen(!isOpen()));

    // A menu that is not a dialog still has to close in the usual ways:
    // a click outside it, Escape (returning focus to the button), or leaving
    // the breakpoint entirely.
    document.addEventListener("click", (event) => {
      if (!isOpen()) return;
      const inside =
        toggle.contains(event.target) ||
        links.contains(event.target) ||
        actions.contains(event.target);
      if (!inside) setOpen(false);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isOpen()) {
        setOpen(false);
        toggle.focus();
      }
    });

    // Above the breakpoint the links are always on screen and the button is
    // hidden, so an open state must not survive a resize.
    function sync() {
      if (!mobileNav.matches) setOpen(false);
    }

    setOpen(false);
    if (mobileNav.addEventListener) mobileNav.addEventListener("change", sync);
    else if (mobileNav.addListener) mobileNav.addListener(sync); // older Safari
  }

  function initScrollShadow() {
    const navbar = $("#navbar");
    if (!navbar) return;

    window.addEventListener("scroll", () => {
      navbar.classList.toggle("scrolled", window.scrollY > 8);
    });
  }

  // The navbar markup is the same canonical block on every page, so the
  // current page is highlighted from the URL rather than by a class someone
  // has to remember to add (or remove) on each page.
  function initActiveLink() {
    const links = document.querySelectorAll("#navLinks .nav-link");
    if (!links.length) return;

    const lastSegment = window.location.pathname.replace(/\/+$/, "").split("/").pop();
    const current = (lastSegment || "index.html").toLowerCase();

    links.forEach((link) => {
      const href = (link.getAttribute("href") || "").split("#")[0].split("?")[0];
      // "../../dashboard.html" and "/predict" both normalise to a bare name.
      const target = href
        .replace(/^(\.\.\/|\.\/)+/, "")
        .replace(/^\/+/, "")
        .replace(/\/+$/, "")
        .toLowerCase();

      const isCurrent = target !== "" && target === current;
      link.classList.toggle("active", isCurrent);
      if (isCurrent) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  function initBadge() {
    if (typeof window.Appointments?.all === "function") {
      window.Appointments.all().catch(() => {});
    }
  }

  function showUser(name, email) {
    const pretty = name.replace(/\b\w/g, (c) => c.toUpperCase());
    const loginBtn = $("#loginBtn");
    const signupBtn = $("#signupBtn");
    const doctorLoginBtn = $('#doctorLoginBtn');
    if (doctorLoginBtn) doctorLoginBtn.hidden = true;
    const chip = $("#userChip");
    if (loginBtn) loginBtn.hidden = true;
    if (signupBtn) signupBtn.hidden = true;
    if (chip) {
      chip.hidden = false;
      const avatar = $("#userAvatar");
      const label = $("#userName");
      if (label) label.textContent = pretty;
      if (avatar) avatar.textContent = pretty.trim().charAt(0).toUpperCase() || "U";
      if (email) chip.title = email;
    }

    window.dispatchEvent(new CustomEvent("hellodoc:user", { detail: { name: pretty, email } }));
    return pretty;
  }

  /* ------------------------------------------------------------
     Account menu: the single place where account settings and
     sign-out live, for every role and every page.
     ------------------------------------------------------------ */
  async function signOut(button) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Signing out…";
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      // The server clears the cookies even when revocation fails, so the
      // visitor leaves the protected page either way.
      if (!response.ok && response.status >= 500) {
        window.location.replace("/login.html");
        return;
      }
      window.location.replace("/index.html");
    } catch {
      button.disabled = false;
      button.textContent = original;
      const note = $("#accountMenuStatus");
      if (note) {
        note.hidden = false;
        note.textContent = "Sign out could not be completed. Check your connection and try again.";
      }
    }
  }

  function menuItem(tag, label, extraClass) {
    const node = document.createElement(tag);
    node.className = `account-menu__item${extraClass ? ` ${extraClass}` : ""}`;
    node.textContent = label;
    node.setAttribute("role", "menuitem");
    return node;
  }

  function buildAccountMenu(role, name, email) {
    const chip = $("#userChip");
    if (!chip || chip.dataset.accountMenu === "ready") return;
    chip.dataset.accountMenu = "ready";

    const menu = document.createElement("div");
    menu.className = "account-menu";
    chip.parentNode.insertBefore(menu, chip);
    menu.append(chip);

    const panel = document.createElement("div");
    panel.className = "account-menu__panel";
    panel.id = "accountMenuPanel";
    panel.hidden = true;
    panel.setAttribute("role", "menu");
    panel.setAttribute("aria-label", "Account menu");

    const identity = document.createElement("div");
    identity.className = "account-menu__identity";
    const display = document.createElement("strong");
    display.id = "accountMenuName";
    display.textContent = name;
    const mail = document.createElement("span");
    mail.id = "accountMenuEmail";
    mail.textContent = email || "";
    identity.append(display, mail);
    panel.append(identity);

    const currentPage = (window.location.pathname.split("/").pop() || "").toLowerCase();
    for (const item of ROLE_LINKS[role] || []) {
      const link = menuItem("a", item.label);
      link.href = item.href;
      if (item.href.replace(/^\/+/, "").toLowerCase() === currentPage) {
        link.setAttribute("aria-current", "page");
      }
      panel.append(link);
    }

    const note = document.createElement("p");
    note.className = "account-menu__status";
    note.id = "accountMenuStatus";
    note.setAttribute("role", "alert");
    note.hidden = true;

    const out = menuItem("button", "Sign out", "account-menu__signout");
    out.type = "button";
    out.addEventListener("click", () => signOut(out));

    panel.append(note, out);
    menu.append(panel);

    chip.setAttribute("aria-haspopup", "menu");
    chip.setAttribute("aria-controls", "accountMenuPanel");
    chip.setAttribute("aria-expanded", "false");

    function closeMenu(returnFocus) {
      if (panel.hidden) return;
      panel.hidden = true;
      chip.setAttribute("aria-expanded", "false");
      if (returnFocus) chip.focus();
    }

    function openMenu() {
      panel.hidden = false;
      chip.setAttribute("aria-expanded", "true");
      const first = panel.querySelector('[role="menuitem"]');
      if (first) first.focus();
    }

    chip.addEventListener("click", () => (panel.hidden ? openMenu() : closeMenu(false)));

    document.addEventListener("click", (event) => {
      if (!panel.hidden && !menu.contains(event.target)) closeMenu(false);
    });

    document.addEventListener("keydown", (event) => {
      if (panel.hidden) return;
      if (event.key === "Escape") {
        closeMenu(true);
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const items = Array.from(panel.querySelectorAll('[role="menuitem"]'));
      if (!items.length) return;
      event.preventDefault();
      const current = items.indexOf(document.activeElement);
      const next =
        event.key === "ArrowDown"
          ? (current + 1) % items.length
          : (current - 1 + items.length) % items.length;
      items[next].focus();
    });

    panel.addEventListener("keydown", (event) => {
      if (event.key === "Tab") closeMenu(false);
    });
  }

  // The patient shell reports a saved name change so the chip and the menu
  // identity stay in step without a second account implementation.
  window.addEventListener("hellodoc:identity", (event) => {
    const { name, email } = event.detail || {};
    if (name) {
      const label = $("#userName");
      const avatar = $("#userAvatar");
      const menuName = $("#accountMenuName");
      if (label) label.textContent = name;
      if (avatar) avatar.textContent = name.trim().charAt(0).toUpperCase() || "U";
      if (menuName) menuName.textContent = name;
    }
    if (email) {
      const menuEmail = $("#accountMenuEmail");
      const chip = $("#userChip");
      if (menuEmail) menuEmail.textContent = email;
      if (chip) chip.title = email;
    }
  });

  window.HelloDocAuth = { signOut };

  async function initAuth() {
    try {
      const res = await fetch("/api/auth/current-user", { credentials: "same-origin" });
      if (res.ok) {
        const data = await res.json();
        const email = data.email || (data.user && data.user.email) || "";
        const name =
          (data.user && data.user.firstName) ||
          (email ? email.split("@")[0].replace(/[._]/g, " ") : "there");
        const label = showUser(name, email);
        buildAccountMenu(data.role, label, email);
        const chip = $("#userChip");
        if (chip) chip.dataset.role = data.role;
        if (data.role === "doctor" && !/\/doctor\.html$/.test(window.location.pathname)) {
          const links = document.querySelector("#navLinks");
          if (links && !links.querySelector('a[href="doctor.html"]')) {
            const item = document.createElement('li');
            const anchor = document.createElement('a');
            anchor.href = 'doctor.html'; anchor.className = 'nav-link'; anchor.textContent = 'Doctor workspace';
            item.append(anchor); links.append(item);
          }
        }
        // Patient pages already carry the full patient navigation in the same
        // navbar, so the extra entry point is only added on public pages.
        if (data.role === "patient" && !document.body.classList.contains("patient-page")) {
          const link = document.createElement("li");
          const anchor = document.createElement("a");
          anchor.href = "patient.html";
          anchor.className = "nav-link";
          anchor.textContent = "My health";
          link.append(anchor);
          const links = document.querySelector("#navLinks");
          if (links && !links.querySelector('a[href="patient.html"]')) links.appendChild(link);
        }
      }
    } catch {
      // Backend unreachable, keep the guest buttons.
    }
  }

  // Emergency access is intentionally separate from HelloDoc's routine-care flow.
  // Browser locale is only a hint, never proof of the user's physical location.
  function initEmergencyAccess() {
    // The floating SOS control has been removed from the site navigation.
    return;
    if (document.getElementById("hdEmergencyRoot")) return;
    const countryHints = {
      FI:"fi", SE:"eu", NO:"eu", DK:"eu", IS:"eu", DE:"eu", FR:"eu", ES:"eu", IT:"eu",
      NL:"eu", BE:"eu", PT:"eu", IE:"eu", AT:"eu", GR:"eu", PL:"eu", EE:"eu", LV:"eu",
      LT:"eu", CZ:"eu", SK:"eu", SI:"eu", HR:"eu", HU:"eu", RO:"eu", BG:"eu", CY:"eu",
      LU:"eu", MT:"eu", US:"us", CA:"ca", GB:"gb", UK:"gb", AU:"au", NZ:"nz", IN:"in", NP:"np"
    };
    const countryNames = {fi:"Finland",eu:"European Union",in:"India",np:"Nepal",us:"United States",ca:"Canada",gb:"United Kingdom",au:"Australia",nz:"New Zealand",other:"Other"};
    function defaultCountry() {
      try {
        const saved = localStorage.getItem("hellodoc-emergency-country");
        if (saved && countryNames[saved]) return saved;
        const region = (navigator.language || "").toUpperCase().match(/[-_]([A-Z]{2})$/)?.[1];
        return countryHints[region] || "other";
      } catch { return "other"; }
    }
    const root = document.createElement("div");
    root.id = "hdEmergencyRoot";
    root.innerHTML = `
      <button class="hd-sos-fab" type="button" aria-haspopup="dialog" aria-controls="hdEmergencyDialog"><span class="hd-sos-fab__pulse" aria-hidden="true"></span><span class="hd-sos-fab__label">SOS</span><span class="hd-sos-fab__sub">Emergency</span></button>
      <section class="hd-emergency-dialog" id="hdEmergencyDialog" role="dialog" aria-modal="true" aria-labelledby="hdEmergencyTitle" aria-describedby="hdEmergencyDescription" hidden>
        <button class="hd-emergency-dialog__scrim" type="button" aria-label="Close emergency panel"></button>
        <div class="hd-emergency-card" role="document">
          <div class="hd-emergency-card__top"><span class="hd-emergency-icon" aria-hidden="true">!</span><button class="hd-emergency-close" type="button" aria-label="Close emergency panel">×</button></div>
          <p class="hd-emergency-eyebrow">EMERGENCY ACCESS</p><h2 id="hdEmergencyTitle">Need urgent help?</h2>
          <p id="hdEmergencyDescription">HelloDoc is for routine appointments, not emergencies. If someone may be in immediate danger, call the local emergency service now.</p>
          <label class="hd-emergency-label" for="hdEmergencyCountry">Where are you right now?</label>
          <select id="hdEmergencyCountry"><option value="other">Choose your country</option><option value="fi">Finland</option><option value="eu">European Union (112)</option><option value="in">India</option><option value="np">Nepal</option><option value="us">United States</option><option value="ca">Canada</option><option value="gb">United Kingdom</option><option value="au">Australia</option><option value="nz">New Zealand</option></select>
          <div id="hdEmergencyServiceWrap" hidden><label class="hd-emergency-label" for="hdEmergencyService">Which service do you need?</label><select id="hdEmergencyService"><option value="ambulance">Ambulance — 102</option><option value="police">Police — 100</option></select></div>
          <div class="hd-emergency-number" aria-live="polite"><span class="hd-emergency-number__label">Local emergency number</span><strong id="hdEmergencyNumber">Choose your country</strong></div>
          <a class="hd-emergency-call" id="hdEmergencyCall" href="#" hidden>Call emergency services</a>
          <p class="hd-emergency-footnote">The suggestion uses browser settings, not GPS. Confirm your country and number before calling, especially when travelling. This panel does not contact emergency services automatically.</p>
        </div>
      </section>`;
    document.body.appendChild(root);
    const dialog = root.querySelector("#hdEmergencyDialog");
    const country = root.querySelector("#hdEmergencyCountry");
    const serviceWrap = root.querySelector("#hdEmergencyServiceWrap");
    const service = root.querySelector("#hdEmergencyService");
    const number = root.querySelector("#hdEmergencyNumber");
    const call = root.querySelector("#hdEmergencyCall");
    const opener = root.querySelector(".hd-sos-fab");
    const closeButtons = root.querySelectorAll(".hd-emergency-close, .hd-emergency-dialog__scrim");
    let previousFocus = null;
    const numbers = {
      fi:{number:"112",label:"112",tel:"112"}, eu:{number:"112",label:"112",tel:"112"},
      in:{number:"112",label:"112",tel:"112"}, np:{ambulance:{number:"102",label:"Ambulance · 102",tel:"102"},police:{number:"100",label:"Police · 100",tel:"100"}},
      us:{number:"911",label:"911",tel:"911"},ca:{number:"911",label:"911",tel:"911"},
      gb:{number:"999",label:"999",tel:"999"},au:{number:"000",label:"000",tel:"000"},nz:{number:"111",label:"111",tel:"111"}
    };
    function updateNumber() {
      const selected = country.value, data = numbers[selected];
      serviceWrap.hidden = selected !== "np";
      const item = selected === "np" ? data?.[service.value] : data;
      if (!item) { number.textContent="Choose your country"; call.hidden=true; call.removeAttribute("href"); return; }
      number.textContent = item.label || item.number;
      call.href = "tel:" + item.tel;
      call.textContent = "Call " + (selected === "np" ? (service.value === "ambulance" ? "ambulance" : "police") : "emergency services") + " · " + item.number;
      call.hidden = false;
    }
    function openDialog() {
      previousFocus = document.activeElement; dialog.hidden = false; document.body.classList.add("hd-emergency-open");
      updateNumber(); root.querySelector(".hd-emergency-close").focus();
    }
    function closeDialog() {
      dialog.hidden = true; document.body.classList.remove("hd-emergency-open");
      if (previousFocus && typeof previousFocus.focus === "function") previousFocus.focus();
    }
    country.value = defaultCountry(); updateNumber();
    opener.addEventListener("click", openDialog);
    closeButtons.forEach((button) => button.addEventListener("click", closeDialog));
    country.addEventListener("change", () => { try { localStorage.setItem("hellodoc-emergency-country", country.value); } catch {} updateNumber(); });
    service.addEventListener("change", updateNumber);
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !dialog.hidden) closeDialog(); });
    const navActions = document.querySelector("#navActions");
    if (navActions) {
      const navButton = document.createElement("button"); navButton.className="hd-sos-nav"; navButton.type="button";
      navButton.textContent="SOS"; navButton.setAttribute("aria-label","Open emergency calling options");
      navButton.addEventListener("click", openDialog); navActions.prepend(navButton);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    initMenu();
    initEmergencyAccess();
    initScrollShadow();
    initPatientNav();
    initActiveLink();
    initBadge();
    initAuth();
  });
})();
