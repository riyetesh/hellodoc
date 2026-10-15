/* ============================================================
   HelloDoc - Appointments store (localStorage-backed)
   Shared by the dashboard (booking) and the appointments page.
   Exposes a tiny API on `window.Appointments` so plain <script>
   pages can use it without a bundler.

   An appointment record:
     {
       id, doctorId, doctorName, speciality, image,
       date: "YYYY-MM-DD", time: "HH:MM", fee,
       reason, status: "upcoming" | "completed" | "cancelled",
       createdAt
     }
   ============================================================ */

(function () {
  const KEY = "hellodoc.appointments.v1";

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function write(list) {
    localStorage.setItem(KEY, JSON.stringify(list));
    // Let other tabs/pages know the data changed.
    try {
      window.dispatchEvent(new CustomEvent("appointments:changed"));
    } catch {
      /* no-op */
    }
  }

  function uid() {
    return "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  const Appointments = {
    all() {
      return read();
    },

    // Active appointments (scheduled or in-progress), soonest first.
    upcoming() {
      return read()
        .filter((a) => a.status === "upcoming" || a.status === "in-progress")
        .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    },

    // Completed + cancelled, most recent first.
    past() {
      return read()
        .filter((a) => a.status === "completed" || a.status === "cancelled")
        .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    },

    countUpcoming() {
      return this.upcoming().length;
    },

    get(id) {
      return read().find((a) => a.id === id) || null;
    },

    add(appt) {
      const list = read();
      const record = Object.assign(
        { id: uid(), status: "upcoming", createdAt: new Date().toISOString() },
        appt
      );
      list.push(record);
      write(list);
      return record;
    },

    update(id, patch) {
      const list = read();
      const idx = list.findIndex((a) => a.id === id);
      if (idx === -1) return null;
      list[idx] = Object.assign({}, list[idx], patch);
      write(list);
      return list[idx];
    },

    cancel(id) {
      return this.update(id, { status: "cancelled" });
    },

    complete(id) {
      return this.update(id, { status: "completed" });
    },

    remove(id) {
      write(read().filter((a) => a.id !== id));
    },

    clear() {
      write([]);
    },
  };

  window.Appointments = Appointments;

  /* ---- small formatting helpers shared by pages ---- */

  // "YYYY-MM-DD" -> "Mon, 12 Jun 2025"
  window.formatApptDate = function (iso) {
    try {
      const [y, m, d] = iso.split("-").map(Number);
      const dt = new Date(y, m - 1, d);
      return dt.toLocaleDateString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return iso;
    }
  };

  // "HH:MM" (24h) -> "4:00 PM"
  window.formatApptTime = function (hhmm) {
    try {
      const [h, m] = hhmm.split(":").map(Number);
      const ampm = h >= 12 ? "PM" : "AM";
      const hour = h % 12 === 0 ? 12 : h % 12;
      return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
    } catch {
      return hhmm;
    }
  };

  // Render the live badge count onto any nav element with [data-appt-badge].
  window.refreshAppointmentBadge = function () {
    const count = window.Appointments.countUpcoming();
    document.querySelectorAll("[data-appt-badge]").forEach((el) => {
      el.textContent = count > 99 ? "99+" : String(count);
      el.classList.toggle("show", count > 0);
    });
  };
})();
