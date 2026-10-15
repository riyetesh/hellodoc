// Login modal + submit handling for the root login page.
document.getElementById("loginBtn").addEventListener("click", function (event) {
  event.preventDefault();
  document.getElementById("login-modal").style.display = "flex";
});

document.querySelector(".close-btn").addEventListener("click", function () {
  document.getElementById("login-modal").style.display = "none";
});

window.addEventListener("click", function (event) {
  if (event.target === document.getElementById("login-modal")) {
    document.getElementById("login-modal").style.display = "none";
  }
});

document.querySelector("#login-modal form").addEventListener("submit", async function (event) {
  event.preventDefault();

  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  try {
    // Same-origin relative URL: works locally and behind the Vercel rewrite to the backend service.
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    if (response.ok) {
      if (data.userId) {
        sessionStorage.setItem("hellodoc.userId", String(data.userId));
      }
      window.location.href = "./dashboard.html";
    } else {
      alert(data.message || "Login failed");
    }
  } catch (error) {
    console.error("Error:", error);
    alert("Could not reach the server. Please try again.");
  }
});
