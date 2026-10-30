(() => {
  'use strict';
  const patients = [
    {id:'p-001',name:'Amelia Carter',age:34,sex:'Female',time:'09:15',status:'Waiting',reason:'Recurring headache and sensitivity to light',history:'No known allergies',vitals:'BP 118/76 · Pulse 78',symptoms:['headache','nausea'],duration:'2–3 days'},
    {id:'p-002',name:'Noah Williams',age:52,sex:'Male',time:'09:30',status:'In consultation',reason:'Persistent cough and mild fever',history:'Seasonal allergies',vitals:'BP 126/82 · Pulse 88',symptoms:['cough','mild fever','fatigue'],duration:'4–7 days'},
    {id:'p-003',name:'Sofia Martinez',age:27,sex:'Female',time:'09:45',status:'Waiting',reason:'Skin irritation and itching',history:'No known allergies',vitals:'BP 112/72 · Pulse 74',symptoms:['itching','skin rash'],duration:'1–2 weeks'},
    {id:'p-004',name:'Liam Anderson',age:41,sex:'Male',time:'10:00',status:'Waiting',reason:'Stomach discomfort after meals',history:'Reports food sensitivity',vitals:'BP 120/78 · Pulse 80',symptoms:['stomach pain','bloating'],duration:'2–3 days'},
    {id:'p-005',name:'Mia Thompson',age:63,sex:'Female',time:'10:15',status:'Waiting',reason:'Joint stiffness and fatigue',history:'No known allergies',vitals:'BP 132/84 · Pulse 82',symptoms:['joint pain','fatigue'],duration:'More than 2 weeks'}
  ];
  const symptoms = ['headache','nausea','cough','mild fever','fatigue','itching','skin rash','stomach pain','bloating','joint pain','sore throat','dizziness'];
  const $ = (id) => document.getElementById(id);
  let selectedId = patients[0].id;
  let startedAt = null;
  let timerId = null;
  let sampleResult = null;
  let completed = new Set();

  function selected(){ return patients.find(p => p.id === selectedId); }
  function renderMetrics(){
    $('waitingCount').textContent = patients.filter(p=>p.status==='Waiting').length;
    $('activeCount').textContent = patients.filter(p=>p.status==='In consultation').length;
    $('completedCount').textContent = completed.size;
    $('queueTotal').textContent = patients.length+' visits';
  }
  function renderQueue(){
    const root=$('patientQueue'), query=$('patientSearch').value.trim().toLowerCase();
    root.replaceChildren();
    const visible=patients.filter(p=>(p.name+' '+p.reason+' '+p.status).toLowerCase().includes(query));
    visible.forEach(p=>{
      const button=document.createElement('button');
      button.type='button'; button.className='demo-queue-item'; button.setAttribute('aria-current',p.id===selectedId?'true':'false');
      const avatar=document.createElement('span'); avatar.className='demo-avatar'; avatar.textContent=p.name.split(' ').map(x=>x[0]).join('');
      const copy=document.createElement('span');
      const name=document.createElement('span'); name.className='demo-queue-name'; name.textContent=p.name;
      const meta=document.createElement('span'); meta.className='demo-queue-detail'; meta.textContent=p.time+' · '+p.reason;
      copy.append(name,meta);
      const state=document.createElement('span'); state.className='demo-queue-state'; state.dataset.state=p.status; state.textContent=p.status;
      button.append(avatar,copy,state); button.addEventListener('click',()=>selectPatient(p.id)); root.append(button);
    });
    if(!visible.length){const empty=document.createElement('p');empty.className='demo-muted';empty.textContent='No matching patients.';root.append(empty);}
    renderMetrics();
  }
  function renderSymptoms(patient){
    const root=$('symptomChoices');root.replaceChildren();
    symptoms.forEach(symptom=>{
      const label=document.createElement('label');label.className='demo-symptom';
      const input=document.createElement('input');input.type='checkbox';input.value=symptom;input.checked=patient.symptoms.includes(symptom);
      input.addEventListener('change',()=>{patient.symptoms=[...root.querySelectorAll('input:checked')].map(x=>x.value);$('saveStatus').textContent='Symptom selection updated in this demo session.';});
      label.append(input,document.createTextNode(symptom));root.append(label);
    });
  }
  function selectPatient(id){
    if(timerId){clearInterval(timerId);timerId=null;}
    selectedId=id;startedAt=null;sampleResult=null;
    const p=selected();
    $('patientWorkspace').hidden=false;$('emptyPatient').hidden=true;
    $('patientHeading').textContent=p.name;
    $('patientMeta').textContent=p.age+' years · '+p.sex+' · Visit '+p.time;
    $('patientStatus').textContent=p.status;$('patientStatus').dataset.state=p.status;
    $('patientFacts').innerHTML='';
    [['Age',p.age+' years'],['Patient ID',p.id.toUpperCase()],['Medical history',p.history],['Vitals',p.vitals]].forEach(([k,v])=>{
      const box=document.createElement('div');box.className='demo-fact';const a=document.createElement('span');a.textContent=k;const b=document.createElement('strong');b.textContent=v;box.append(a,b);$('patientFacts').append(box);
    });
    $('visitReason').textContent=p.reason;
    $('symptomDuration').value=p.duration;
    $('clinicalNotes').value='';
    $('doctorAssessment').value='';
    $('carePlan').value='';
    $('assessmentResult').hidden=true;
    $('runAssessment').disabled=false;
    $('startConsultation').disabled=p.status==='Completed';
    $('endConsultation').disabled=true;
    $('consultationClock').textContent=p.status==='Completed'?'Visit completed':'Not started';
    $('saveStatus').textContent='Demo changes are held in this browser session.';
    renderSymptoms(p);renderQueue();
  }
  function startConsultation(){
    const p=selected();if(!p||p.status==='Completed'||startedAt)return;
    startedAt=Date.now();p.status='In consultation';
    $('startConsultation').disabled=true;$('endConsultation').disabled=false;
    const tick=()=>{const seconds=Math.floor((Date.now()-startedAt)/1000);$('consultationClock').textContent='In consultation · '+String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');};
    tick();timerId=setInterval(tick,1000);renderQueue();$('patientStatus').textContent=p.status;$('patientStatus').dataset.state=p.status;
  }
  function endConsultation(){
    if(!startedAt)return;
    clearInterval(timerId);timerId=null;
    const seconds=Math.floor((Date.now()-startedAt)/1000);
    $('consultationClock').textContent='Ended · '+Math.floor(seconds/60)+'m '+(seconds%60)+'s';
    startedAt=null;$('endConsultation').disabled=true;$('startConsultation').disabled=false;
    $('saveStatus').textContent='Consultation timer stopped. Complete the visit when documentation is ready.';
  }
  function runAssessment(){
    const p=selected();if(!p)return;
    const samples=[
      {label:'Tension-type headache · sample',detail:'Illustrative reference category only. The selected symptoms were not analysed by a machine-learning model.',precautions:['Record symptom pattern and triggers','Review any new or worsening symptoms','Seek urgent care for sudden severe headache or neurological symptoms']},
      {label:'Upper respiratory infection · sample',detail:'Illustrative reference category only. This is not a prediction or a diagnosis.',precautions:['Monitor temperature and breathing','Encourage fluids and rest','Arrange clinical review if symptoms worsen or persist']},
      {label:'Contact dermatitis · sample',detail:'Illustrative reference category only. This is not a prediction or a diagnosis.',precautions:['Review possible skin irritants','Avoid scratching the affected area','Seek clinical review if rash spreads or becomes painful']},
      {label:'Dyspepsia · sample',detail:'Illustrative reference category only. This is not a prediction or a diagnosis.',precautions:['Review meal patterns and possible triggers','Monitor for persistent or severe abdominal pain','Seek urgent care for vomiting blood or black stools']},
      {label:'Joint pain · sample',detail:'Illustrative reference category only. This is not a prediction or a diagnosis.',precautions:['Document affected joints and stiffness pattern','Review impact on mobility','Arrange further assessment if pain persists or worsens']}
    ];
    sampleResult=samples[patients.indexOf(p)]||samples[0];
    const box=$('assessmentResult');box.replaceChildren();box.hidden=false;
    const title=document.createElement('strong');title.textContent=sampleResult.label;
    const desc=document.createElement('p');desc.textContent=sampleResult.detail;
    const list=document.createElement('ul');sampleResult.precautions.forEach(item=>{const li=document.createElement('li');li.textContent=item;list.append(li);});
    box.append(title,desc,list);
    $('doctorAssessment').value=$('doctorAssessment').value||'Review the patient history, symptom duration and clinical findings before making a diagnosis.';
    $('saveStatus').textContent='Sample assessment displayed. It is not a live model result.';
  }
  function completeVisit(){
    const p=selected();if(!p)return;
    if(startedAt)endConsultation();
    p.status='Completed';completed.add(p.id);
    $('patientStatus').textContent='Completed';$('patientStatus').dataset.state='Completed';
    $('startConsultation').disabled=true;$('endConsultation').disabled=true;
    $('saveStatus').textContent='Visit marked complete in this demo session only.';
    renderQueue();
  }
  function printReport(){
    const p=selected();if(!p)return;
    const report=document.createElement('section');report.className='demo-print-report';
    const title=document.createElement('h1');title.textContent='HelloDoc · Sample consultation report';
    const warning=document.createElement('p');warning.textContent='DEMO ONLY — fictional patient record. Not a real medical report.';
    const info=document.createElement('p');info.textContent=p.name+' · '+p.age+' years · '+p.id+' · '+new Date().toLocaleString();
    const reason=document.createElement('p');reason.textContent='Reason for visit: '+p.reason;
    const selectedSymptoms=[...$('symptomChoices').querySelectorAll('input:checked')].map(x=>x.value).join(', ')||'None recorded';
    const symptom=document.createElement('p');symptom.textContent='Symptoms: '+selectedSymptoms+' · Duration: '+$('symptomDuration').value;
    const notes=document.createElement('p');notes.textContent='Clinical observations: '+$('clinicalNotes').value;
    const assessment=document.createElement('p');assessment.textContent='Doctor assessment: '+$('doctorAssessment').value;
    const plan=document.createElement('p');plan.textContent='Care plan: '+$('carePlan').value;
    report.append(title,warning,info,reason,symptom,notes,assessment,plan);
    const old=document.querySelector('.demo-print-report');if(old)old.remove();
    document.body.append(report);window.print();report.remove();
  }
  function reset(){
    if(timerId)clearInterval(timerId);timerId=null;startedAt=null;completed.clear();
    patients.forEach((p,i)=>{p.status=i===1?'In consultation':'Waiting';});
    patients[0].status='Waiting';patients[1].status='In consultation';
    selectedId=patients[0].id;selectPatient(selectedId);
    $('patientSearch').value='';renderQueue();
  }
  $('patientSearch').addEventListener('input',renderQueue);
  $('startConsultation').addEventListener('click',startConsultation);
  $('endConsultation').addEventListener('click',endConsultation);
  $('runAssessment').addEventListener('click',runAssessment);
  $('completeVisit').addEventListener('click',completeVisit);
  $('printReport').addEventListener('click',printReport);
  $('resetDemo').addEventListener('click',reset);
  selectPatient(selectedId);
})();
