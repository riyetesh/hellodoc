// Signup form handling for the root signup page.
document.addEventListener("DOMContentLoaded", function () {
  const form = document.querySelector(".signup-form");
  if (!form) return;

  form.addEventListener("submit", async function (event) {
    event.preventDefault();

    const firstName = document.getElementById("firstName").value;
    const lastName = document.getElementById("lastName").value;
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;
    const dob = document.getElementById("dob").value;
    const sex = document.querySelector("input[name='sex']:checked").value;

    const requestData = { firstName, lastName, email, password, dob, sex };

    try {
      // Same-origin relative URL: works locally and behind the Vercel rewrite to the backend service.
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestData),
      });

      const data = await response.json();
      if (response.ok) {
        alert("Signup successful! ✅");
        window.location.href = "login.html";
      } else {
        alert(data.message || "Signup failed");
      }
    } catch (error) {
      console.error("Error:", error);
      alert("Could not reach the server. Please try again.");
    }
  });
});
