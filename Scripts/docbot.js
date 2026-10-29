/* HelloDoc DocBot: lightweight website-help assistant. No API key or external service required. */
(function () {
  "use strict";
  if (document.getElementById("hdDocBotRoot")) return;
  const root = document.createElement("section");
  root.id = "hdDocBotRoot";
  root.innerHTML = `
    <button class="hd-docbot-launcher" type="button" aria-controls="hdDocBotPanel" aria-expanded="false">
      <span class="hd-docbot-mark" aria-hidden="true">D</span><span class="hd-docbot-launcher-copy"><strong>DocBot</strong><small>Website help</small></span><span class="hd-docbot-online" aria-hidden="true"></span>
    </button>
    <section class="hd-docbot-panel" id="hdDocBotPanel" aria-label="DocBot website help" hidden>
      <header class="hd-docbot-header"><span class="hd-docbot-mark" aria-hidden="true">D</span><div><strong>DocBot</strong><small>HelloDoc website assistant</small></div><button class="hd-docbot-close" type="button" aria-label="Close DocBot">×</button></header>
      <div class="hd-docbot-messages" role="log" aria-live="polite" aria-relevant="additions"><div class="hd-docbot-message hd-docbot-bot">Hi, I’m DocBot. I can help you use HelloDoc, find features, manage appointments, or understand the doctor workspace. What do you need help with?</div></div>
      <div class="hd-docbot-prompts" aria-label="Suggested questions"><button type="button">How do I book an appointment?</button><button type="button">How do I reset my password?</button><button type="button">How does the doctor workspace work?</button></div>
      <form class="hd-docbot-form"><label class="visually-hidden" for="hdDocBotInput">Ask DocBot a website question</label><input id="hdDocBotInput" maxlength="500" autocomplete="off" placeholder="Ask about HelloDoc…" required><button type="submit">Send</button></form>
      <p class="hd-docbot-note">Website guidance only — not medical advice or emergency care.</p>
    </section>`;
  document.body.appendChild(root);
  const panel = root.querySelector(".hd-docbot-panel"), launcher = root.querySelector(".hd-docbot-launcher");
  const messages = root.querySelector(".hd-docbot-messages"), input = root.querySelector("#hdDocBotInput");
  const faq = [
    {k:["book","booking","appointment","schedule","available slot","find a doctor"],a:"To book a visit, sign in as a patient, open Find a Doctor, choose an approved doctor, select View times, pick an available slot, and confirm. Your booking appears under My Appointments.",u:"dashboard.html",l:"Find a doctor"},
    {k:["cancel","cancellation"],a:"Open My Appointments and use the cancellation option on your upcoming visit. To choose another time, cancel and book a new available slot; one-click rescheduling is not currently available.",u:"appointments.html",l:"My appointments"},
    {k:["reschedule","change appointment","change time","different time"],a:"Direct rescheduling is not currently available. Cancel the upcoming visit under My Appointments, then book a new available slot.",u:"appointments.html",l:"My appointments"},
    {k:["sign up","signup","register","create account","new account"],a:"Choose Sign Up and select Patient or Doctor. Patients enter basic contact and login details. Doctors also submit professional credentials for verification.",u:"signup.html",l:"Sign up"},
    {k:["login","log in","sign in","wrong portal","account type"],a:"Open Login and choose the account type that matches your account: Patient, Doctor, or Admin.",u:"login.html",l:"Login"},
    {k:["password","forgot password","reset password","recover"],a:"On the Login page, select Forgot password, enter your registered email, and follow the secure recovery link sent to that address.",u:"recover.html",l:"Recover password"},
    {k:["doctor verify","verification","verify doctor","license","approved doctor","doctor approval"],a:"Doctor accounts must submit professional credentials for administrator review. Doctor-only workspace features are available after approval. If your status is pending, wait for verification or contact support.",u:"doctor-apply.html",l:"Doctor application"},
    {k:["doctor workspace","doctor dashboard","assessment","symptom model","predict","clinical record","doctor appointment"],a:"Approved doctors can open assigned visits, record symptoms and duration, run the symptom model, review the result, and save a clinical assessment. Model output is decision support only and does not replace clinical judgment.",u:"doctor.html",l:"Doctor workspace"},
    {k:["model","prediction","disease prediction","symptoms"],a:"The symptom model is an experimental decision-support feature for approved doctors during a consultation. Its suggestions are not a confirmed diagnosis; a clinician must review all output.",u:"doctor.html",l:"Doctor workspace"},
    {k:["diagnose me","diagnosis","medicine","medication","dose","treatment","pain","sick","symptom","medical advice"],a:"I can explain how to use the HelloDoc website, but I cannot diagnose symptoms or recommend treatment or medication. Please consult a qualified healthcare professional.",u:"help.html",l:"Help and safety"},
    {k:["emergency","urgent","sos","ambulance"],a:"HelloDoc is for routine appointments, not emergency care. Use the SOS button to check emergency-number guidance, confirm your current country, and call emergency services directly. DocBot does not contact them for you."},
    {k:["records","health record","past assessment","report","pdf"],a:"Use Health Records to view available saved records. After a doctor saves a consultation assessment, the report page shows the stored result and available report options.",u:"records.html",l:"Health records"},
    {k:["walk in","walk-in","queue","waiting queue"],a:"The Walk-in Queue page explains the clinic queue and offers available walk-in options where supported. Severe or urgent symptoms need emergency care, not a routine queue.",u:"walkin.html",l:"Walk-in queue"},
    {k:["profile","phone number","update my details","account settings"],a:"Patients can manage supported contact details from Account and Settings after signing in.",u:"account.html",l:"Account and settings"},
    {k:["admin","administrator"],a:"The Admin portal is for authorised administrators to review doctor applications, manage accounts and appointments, and inspect audit records.",u:"/admin",l:"Administration"},
    {k:["contact","support","email","help"],a:"Open the Help page for more information. The platform help information lists hi@hellodoc.com as the support email; DocBot cannot verify mailbox availability.",u:"help.html",l:"Help page"},
    {k:["what is hellodoc","about hellodoc","how does hellodoc work","platform"],a:"HelloDoc is a clinic and consultation platform prototype. Patients can browse approved doctors and book visits; doctors manage assigned appointments and clinical assessments; administrators review professional verification and platform records.",u:"help.html",l:"About HelloDoc"}
  ];
  function findAnswer(question) {
    const q = question.toLowerCase().replace(/[^a-z0-9\\s-]/g," ").replace(/\\s+/g," ").trim();
    let best = null, score = 0;
    for (const item of faq) { let n = 0; for (const key of item.k) if (q.includes(key)) n += key.includes(" ") ? 3 : 1; if (n > score) { best=item; score=n; } }
    return best || {a:"I don’t have a reliable answer for that specific question yet. I can help with signing up, login and password recovery, appointments, doctor verification, clinical records, and navigating HelloDoc. Open the Help page for more information.",u:"help.html",l:"Open Help"};
  }
  function message(text, who, url, label) {
    const node=document.createElement("div"); node.className="hd-docbot-message "+(who==="user"?"hd-docbot-user":"hd-docbot-bot"); node.textContent=text;
    if(url&&label){const link=document.createElement("a");link.className="hd-docbot-link";link.href=url;link.textContent=label+" →";node.append(document.createElement("br"),link);}
    messages.appendChild(node);messages.scrollTop=messages.scrollHeight;
  }
  function send(value){const q=value.trim();if(!q)return;message(q,"user");const a=findAnswer(q);window.setTimeout(()=>message(a.a,"bot",a.u,a.l),120);}
  function open(show){panel.hidden=!show;launcher.setAttribute("aria-expanded",String(show));if(show)input.focus();}
  launcher.addEventListener("click",()=>open(panel.hidden));root.querySelector(".hd-docbot-close").addEventListener("click",()=>open(false));
  root.querySelector(".hd-docbot-form").addEventListener("submit",e=>{e.preventDefault();const q=input.value;input.value="";send(q);input.focus();});
  root.querySelector(".hd-docbot-prompts").addEventListener("click",e=>{const b=e.target.closest("button");if(b)send(b.textContent);});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!panel.hidden){open(false);launcher.focus();}});
})();