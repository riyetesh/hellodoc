/* HelloDoc appointment API: no health record is persisted in browser storage. */
(function () {
  async function request(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "Request failed");
    return data;
  }
  let current = [];
  const notify = () => {
    window.dispatchEvent(new Event("appointments:changed"));
    window.refreshAppointmentBadge();
  };
  window.Appointments = {
    async all() {
      const data = await request("/api/patient/overview");
      current = data.appointments;
      notify();
      return current;
    },
    upcoming() { return current.filter((a) => ["pending", "confirmed"].includes(a.status)); },
    past() { return current.filter((a) => ["completed", "cancelled", "no_show"].includes(a.status)); },
    countUpcoming() { return this.upcoming().length; },
    async add({ slotId, reason, idempotencyKey }) {
      const result = await request("/api/patient/appointments", {
        method: "POST", body: JSON.stringify({ slotId, reason, idempotencyKey })
      });
      try { await this.all(); } catch { current = []; notify(); result.refreshFailed = true; }
      return result;
    },
    async cancel(id) {
      const result = await request(`/api/patient/appointments/${encodeURIComponent(id)}/cancel`, { method: "PATCH" });
      try { await this.all(); } catch { current = []; notify(); result.refreshFailed = true; }
      return result;
    },
  };
  window.formatApptDate = function (iso) {
    return new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  };
  window.formatApptTime = function (iso) {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  };
  window.refreshAppointmentBadge = function () {
    const count = window.Appointments.countUpcoming();
    document.querySelectorAll("[data-appt-badge]").forEach((el) => {
      el.textContent = count > 99 ? "99+" : String(count);
      el.classList.toggle("show", count > 0);
    });
  };
})();
