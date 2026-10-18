/* ろくろ日和 — browser-only pottery game. No dependencies or server. */
(() => {
  'use strict';
  const COUNT = 48;
  const STORAGE_KEY = 'rokuro-biyori-gallery-v1';
  const stages = [
    {name:'はじめての茶碗', short:'茶碗', desc:'口がひらいた、やさしい形のお茶碗をつくろう。', hint:'底は小さく、口を広げよう', difficulty:1,
      knots:[[0,.50],[.11,.57],[.32,.73],[.61,.88],[.86,1.01],[1,1.07]]},
    {name:'まっすぐな湯のみ', short:'湯のみ', desc:'ゆったりとした、すっきり背の高い湯のみ。',hint:'細長く、上までまっすぐ', difficulty:2,
      knots:[[0,.60],[.1,.67],[.28,.72],[.57,.73],[.83,.75],[1,.79]]},
    {name:'一輪挿しの花瓶', short:'花瓶', desc:'ふくらんだ胴から、きゅっと細い首へ。',hint:'下をふくらませ、首を細く',difficulty:3,
      knots:[[0,.44],[.1,.53],[.30,.79],[.53,.83],[.70,.61],[.86,.38],[.95,.39],[1,.52]]},
    {name:'風情ある徳利', short:'徳利', desc:'まるいお腹と、細い口。日本酒を注ぐ徳利。',hint:'お腹を丸く、口を小さく',difficulty:4,
      knots:[[0,.43],[.1,.59],[.28,.84],[.48,.91],[.66,.78],[.81,.46],[.92,.34],[1,.41]]},
    {name:'名匠のふっくら壺',short:'壺',desc:'大胆なふくらみと、絞った口。最後の大作。',hint:'真ん中を大胆にふくらませよう',difficulty:5,
      knots:[[0,.49],[.08,.66],[.25,.96],[.45,1.13],[.62,1.04],[.81,.72],[.94,.59],[1,.64]]}
  ];
  const glazes = {
    clay:{name:'素焼き',caption:'土のぬくもり',base:'#c47858',dark:'#814a36',light:'#f1b18c',rim:'#a86548',inner:'#6b4538'},
    jade:{name:'青磁',caption:'静かな青みどり',base:'#749b91',dark:'#406b69',light:'#bdd7bb',rim:'#6a9388',inner:'#3e6668'},
    indigo:{name:'藍釉',caption:'深い夜の青',base:'#3e637e',dark:'#203b53',light:'#8aaec2',rim:'#557c94',inner:'#233a4d'},
    cream:{name:'粉引',caption:'やさしい白',base:'#decaaa',dark:'#ad9177',light:'#fff3d8',rim:'#cfb99f',inner:'#a58b72'},
    charcoal:{name:'黒陶',caption:'しっとり墨色',base:'#665a54',dark:'#302c2b',light:'#a4988f',rim:'#605650',inner:'#262321'}
  };
  const $ = id => document.getElementById(id);
  const canvas = $('potteryCanvas');
  const ctx = canvas.getContext('2d', {alpha:false});
  const refCanvas = $('referenceCanvas');
  const refCtx = refCanvas.getContext('2d');
  const modalEl = $('modalBackdrop');
  const modalInner = $('modalInner');
  let stageIndex = 0, glaze = 'clay', current = [], targets = [], history = [],
      started = false, modalKind = '', guide = true, dragging = false, pointerId = null,
      dragSide = 1, dragStartProfile = [], dragChanged = false, editY = .58,
      seconds = 0, lastTime = 0, lastRender = 0, firstDrag = false, sound = false, audioCtx = null;
  let view = {w:500,h:500,center:250,top:100,bottom:385,height:270,scale:100};
  let gallery = loadGallery();
  let toastTimer = null;

  function clamp(x,a,b){ return Math.min(b,Math.max(a,x)); }
  function makeShape(knots) {
    return Array.from({length:COUNT},(_,i) => {
      const t = i/(COUNT-1);
      let j=0;
      while(j<knots.length-2 && t>knots[j+1][0]) j++;
      const [x1,y1]=knots[j], [x2,y2]=knots[j+1];
      const s = clamp((t-x1)/(x2-x1),0,1), s2=s*s, s3=s2*s;
      const before=knots[Math.max(0,j-1)], after=knots[Math.min(knots.length-1,j+2)];
      const d1=j===0?(y2-y1)/(x2-x1):(y2-before[1])/(x2-before[0]);
      const d2=j+2>=knots.length?(y2-y1)/(x2-x1):(after[1]-y1)/(after[0]-x1);
      const dx=x2-x1;
      return clamp((2*s3-3*s2+1)*y1+(s3-2*s2+s)*dx*d1+(-2*s3+3*s2)*y2+(s3-s2)*dx*d2,.27,1.18);
    });
  }
  const initialShapes = [
    makeShape([[0,.57],[.1,.62],[.4,.70],[.8,.71],[1,.72]]),
    makeShape([[0,.48],[.1,.55],[.4,.61],[.8,.60],[1,.54]])
  ];
  const initialForStage = () => initialShapes[stageIndex===1?1:0];
  function setStage(index) {
    stageIndex=index;
    targets=makeShape(stages[index].knots);
    current=initialForStage().slice(); history=[]; seconds=0; editY=.6; firstDrag=false;
    $('stageCount').textContent=String(index+1).padStart(2,'0')+' / 05';
    $('orderName').textContent=stages[index].name;
    $('orderDesc').textContent=stages[index].desc;
    $('referenceName').textContent=stages[index].short;
    $('referenceDesc').textContent=stages[index].hint;
    $('difficulty').textContent='● '.repeat(stages[index].difficulty)+'○ '.repeat(5-stages[index].difficulty);
    $('stageSteps').innerHTML=stages.map((_,i) => `<span class="stage-step ${i<index?'done':i===index?'current':''}" aria-label="${i+1}番目のステージ${i===index?'、現在':''}"></span>`).join('');
    updateFit(); updateClock(); updateButtons(); drawReference(); resize();
    $('canvasHint').classList.remove('visible');
  }
  function updateButtons(){ $('undoButton').disabled=!started||!history.length; $('finishButton').disabled=!started; $('resetButton').disabled=!started; }
  function scoreShape(profile) {
    let e=0, weightSum=0, rough=0;
    for(let i=0;i<COUNT;i++) {
      const t=i/(COUNT-1), weight=1+.32*t + (t>.74?.18:0);
      e+=weight*Math.abs(profile[i]-targets[i]); weightSum+=weight;
      if(i>0&&i<COUNT-1) rough+=Math.max(0,Math.abs(profile[i-1]-2*profile[i]+profile[i+1])-.014);
    }
    return clamp(Math.round(100-(e/weightSum)*145-rough*.37),0,100);
  }
  function updateFit(){ const fit=scoreShape(current); $('fitNumber').innerHTML=fit+'<small>%</small>'; $('fitFill').style.width=fit+'%'; }
  function updateClock(){const s=Math.floor(seconds);$('timeReadout').textContent=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');}
  function loadGallery(){
    try {
      const value=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}');
      if(!value||typeof value!=='object')return {};
      const clean={};
      for(let i=0;i<stages.length;i++){
        const entry=value[i];
        if(entry && Array.isArray(entry.shape) && entry.shape.length===COUNT && entry.shape.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=.25&&v<=1.2) && glazes[entry.glaze] && Number.isFinite(entry.score)) clean[i]=entry;
      }
      return clean;
    }catch{return {};}
  }
  function saveGallery(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(gallery));}catch{showToast('保存できませんでした。プライベートモードをご確認ください。');}}
  function playTone(freq=330, duration=.08, type='sine', vol=.035){
    if(!sound)return;
    try{
      audioCtx??=new(window.AudioContext||window.webkitAudioContext)();
      if(audioCtx.state==='suspended')audioCtx.resume();
      const osc=audioCtx.createOscillator(),gain=audioCtx.createGain(),now=audioCtx.currentTime;
      osc.type=type; osc.frequency.setValueAtTime(freq,now);
      gain.gain.setValueAtTime(vol,now); gain.gain.exponentialRampToValueAtTime(.0001,now+duration);
      osc.connect(gain); gain.connect(audioCtx.destination); osc.start(now);osc.stop(now+duration+.005);
    }catch{sound=false;updateSound();}
  }
  function successSound(){playTone(392,.14,'sine',.05);if(sound){setTimeout(()=>playTone(523,.21,'sine',.04),125);setTimeout(()=>playTone(659,.32,'sine',.035),260);}}
  function updateSound(){ $('soundState').textContent=sound?'ON':'OFF';$('soundButton').setAttribute('aria-label',`効果音を${sound?'オフ':'オン'}にする`); }
  function showToast(msg){const el=$('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2300);}
  function resize() {
    const r=canvas.getBoundingClientRect();
    if(!r.width||!r.height)return;
    const dpr=Math.min(2,window.devicePixelRatio||1);
    canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const heightRatio=[.36,.48,.56,.56,.46][stageIndex];
    view={w:r.width,h:r.height,center:r.width*.5,bottom:r.height*.788,height:Math.min(r.height*heightRatio,300),scale:Math.min(r.width*.224,116,r.height*.32)};
    view.top=view.bottom-view.height;
    drawScene(performance.now());
  }
  function colorMix(a,b,t){
    const rgb=v=>[1,3,5].map(i=>parseInt(v.slice(i,i+2),16));const c=rgb(a),d=rgb(b);
    return `rgb(${c.map((v,i)=>Math.round(v+(d[i]-v)*t)).join(',')})`;
  }
  function at(profile,t){
    const x=clamp(t,0,1)*(profile.length-1),i=Math.floor(x),f=x-i;
    return profile[i]*(1-f)+profile[Math.min(i+1,profile.length-1)]*f;
  }
  function bodyPath(g,profile,cx,base,height,scale) {
    g.beginPath();
    for(let i=COUNT-1;i>=0;i--){const y=base-height*i/(COUNT-1),x=cx+profile[i]*scale;if(i===COUNT-1)g.moveTo(x,y);else g.lineTo(x,y);}
    for(let i=0;i<COUNT;i++){const y=base-height*i/(COUNT-1),x=cx-profile[i]*scale;g.lineTo(x,y);}
    g.closePath();
  }
  function drawVessel(g,profile,glazeKey,cx,base,height,scale,opts={}) {
    const pal=glazes[glazeKey]||glazes.clay,top=base-height,rt=profile[COUNT-1]*scale;
    g.save();
    if(opts.shadow!==false){g.shadowColor='rgba(65,38,23,.20)';g.shadowBlur=18;g.shadowOffsetY=5;}
    bodyPath(g,profile,cx,base,height,scale);
    const grad=g.createLinearGradient(cx-scale*1.25,top,cx+scale*1.25,base);
    grad.addColorStop(0,pal.dark);grad.addColorStop(.18,pal.base);grad.addColorStop(.37,pal.light);grad.addColorStop(.53,pal.base);grad.addColorStop(.74,pal.base);grad.addColorStop(1,pal.dark);
    g.fillStyle=opts.silhouette?'#d4b99b':grad;g.fill();
    g.shadowBlur=0;g.shadowOffsetY=0;
    if(!opts.silhouette){
      g.save();bodyPath(g,profile,cx,base,height,scale);g.clip();
      const gleam=g.createLinearGradient(cx-scale*.3,top,cx+scale*.45,top);
      gleam.addColorStop(0,'rgba(255,255,255,0)');gleam.addColorStop(.35,'rgba(255,253,229,.11)');gleam.addColorStop(1,'rgba(255,255,255,0)');
      g.fillStyle=gleam;g.fillRect(cx-scale*.7,top,scale*1.35,height);
      const phase=opts.phase||0;
      for(let j=12;j<height-5;j+=8){
        const t=1-j/height,r=at(profile,t)*scale;
        g.beginPath();g.moveTo(cx-r,top+j);g.quadraticCurveTo(cx,top+j+5*Math.cos(j*.16+phase),cx+r,top+j);
        g.strokeStyle=(j%24<9)?'rgba(255,247,226,.11)':'rgba(70,40,28,.075)';g.lineWidth=1;g.stroke();
      }
      g.restore();
      g.strokeStyle='rgba(80,49,35,.18)';g.lineWidth=1.5;bodyPath(g,profile,cx,base,height,scale);g.stroke();
    }
    // The hollow ellipse remains legible on narrow-necked pieces.
    const ry=clamp(rt*.17,4,17);
    g.beginPath();g.ellipse(cx,top,rt,ry,0,0,Math.PI*2);
    g.fillStyle=opts.silhouette?'#ae9179':pal.rim;g.fill();
    g.strokeStyle=opts.silhouette?'#d4b99b':colorMix(pal.light,pal.base,.36);g.lineWidth=opts.silhouette?2.5:3.2;g.stroke();
    g.beginPath();g.ellipse(cx,top+1,Math.max(1,rt-5),Math.max(2,ry-3),0,0,Math.PI*2);
    g.fillStyle=opts.silhouette?'#8b7565':pal.inner;g.fill();
    if(!opts.silhouette){
      g.beginPath();g.ellipse(cx,top+2,Math.max(1,rt-9),Math.max(1,ry-5),0,0,Math.PI*2);
      g.strokeStyle='rgba(255,241,221,.17)';g.lineWidth=1;g.stroke();
      g.beginPath();g.moveTo(cx-profile[0]*scale,base-1);g.lineTo(cx+profile[0]*scale,base-1);g.strokeStyle='rgba(40,26,19,.15)';g.lineWidth=2;g.stroke();
    }
    g.restore();
  }
  function drawScene(now) {
    const {w,h,center:cx,bottom,top,height,scale}=view;
    const g=ctx,phase=now*.001;
    g.clearRect(0,0,w,h);
    const bg=g.createLinearGradient(0,0,w,h);
    bg.addColorStop(0,'#e9ddcb');bg.addColorStop(.55,'#f1e3cf');bg.addColorStop(1,'#d8bda2');g.fillStyle=bg;g.fillRect(0,0,w,h);
    const wash=g.createRadialGradient(w*.72,h*.08,8,w*.72,h*.08,w*.8);
    wash.addColorStop(0,'rgba(255,255,240,.51)');wash.addColorStop(1,'rgba(255,255,240,0)');g.fillStyle=wash;g.fillRect(0,0,w,h);
    g.fillStyle='rgba(135,100,77,.044)';
    for(let i=0;i<95;i++) {const x=((i*97.137)%103)/103*w,y=((i*71.73)%97)/97*h;g.fillRect(x,y,i%3===0?2:1,1);}
    g.fillStyle='rgba(116,89,72,.11)';g.fillRect(0,h*.834,w,h*.166);
    g.fillStyle='rgba(255,248,229,.22)';g.fillRect(0,h*.835,w,1.5);
    // A few unintrusive atelier shapes in the background.
    g.save();g.globalAlpha=.10;g.strokeStyle='#9c7867';g.lineWidth=3;
    g.beginPath();g.moveTo(w*.10,h*.72);g.lineTo(w*.10,h*.39);g.quadraticCurveTo(w*.10,h*.32,w*.15,h*.32);g.stroke();
    g.beginPath();g.moveTo(w*.85,h*.54);g.quadraticCurveTo(w*.88,h*.45,w*.9,h*.56);g.quadraticCurveTo(w*.93,h*.65,w*.91,h*.72);g.stroke();
    g.restore();
    // Turntable pedestal.
    const wheelY=bottom+scale*.16;
    g.save();g.fillStyle='rgba(73,45,33,.16)';g.beginPath();g.ellipse(cx,wheelY+scale*.69,scale*1.71,scale*.26,0,0,Math.PI*2);g.fill();
    const stand=g.createLinearGradient(0,wheelY,0,wheelY+scale*.62);
    stand.addColorStop(0,'#7c6555');stand.addColorStop(1,'#55473e');
    g.fillStyle=stand;g.beginPath();g.moveTo(cx-scale*1.31,wheelY);g.lineTo(cx+scale*1.31,wheelY);g.lineTo(cx+scale*1.20,wheelY+scale*.54);g.quadraticCurveTo(cx,wheelY+scale*.76,cx-scale*1.20,wheelY+scale*.54);g.closePath();g.fill();
    g.fillStyle='#5c5046';g.beginPath();g.ellipse(cx,wheelY+scale*.55,scale*1.19,scale*.18,0,0,Math.PI*2);g.fill();
    g.fillStyle='#ad8770';g.beginPath();g.ellipse(cx,wheelY-1,scale*1.48,scale*.31,0,0,Math.PI*2);g.fill();
    g.fillStyle='#6b5547';g.beginPath();g.ellipse(cx,wheelY-5,scale*1.39,scale*.24,0,0,Math.PI*2);g.fill();
    g.strokeStyle='#bd9c83';g.lineWidth=3;g.beginPath();g.ellipse(cx,wheelY-6,scale*1.36,scale*.22,0,0,Math.PI*2);g.stroke();
    // Rotating scratched highlights.
    for(let k=0;k<7;k++){
      const a=k*Math.PI*2/7+phase*1.8;
      g.beginPath();g.ellipse(cx,wheelY-6,scale*(.56+k*.098),scale*(.10+k*.018),0,a,a+.5);
      g.strokeStyle='rgba(238,207,171,.26)';g.lineWidth=2;g.stroke();
    }
    g.restore();
    // Ghost guide behind and slightly over the pot is usable on any screen size.
    drawVessel(g,current,glaze,cx,bottom,height,scale,{phase});
    if(guide && started && !modalKind)drawGuide(g,cx,top,bottom,height,scale,true);
    // Turntable's near rim overlays the vessel foot.
    g.beginPath();g.ellipse(cx,wheelY+scale*.015,scale*1.47,scale*.31,0,.065,Math.PI-.065);
    g.strokeStyle='#a27a62';g.lineWidth=5;g.stroke();
    g.beginPath();g.ellipse(cx,wheelY+scale*.016,scale*1.4,scale*.265,0,.1,Math.PI-.1);
    g.strokeStyle='rgba(247,210,173,.27)';g.lineWidth=2;g.stroke();
    if(dragging || (document.activeElement===canvas && started && !modalKind)){
      const y=bottom-height*editY,rad=at(current,editY)*scale;
      g.setLineDash([3,5]);g.strokeStyle='rgba(255,253,239,.85)';g.lineWidth=2;
      g.beginPath();g.ellipse(cx,y,rad+11,8,0,0,Math.PI*2);g.stroke();g.setLineDash([]);
      for(const side of [-1,1]){
        g.beginPath();g.arc(cx+side*(rad+12),y,4.5,0,Math.PI*2);
        g.fillStyle='#fef9ea';g.fill();g.strokeStyle='#a46c51';g.lineWidth=1.7;g.stroke();
      }
    }
  }
  function drawGuide(g,cx,top,base,height,scale,front){
    g.save();g.setLineDash([5,6]);g.strokeStyle=front?'rgba(255,245,207,.93)':'rgba(115,91,66,.55)';g.lineWidth=front?2.2:2.3;
    if(front){g.shadowColor='rgba(67,45,28,.64)';g.shadowBlur=2;}
    for(const side of [-1,1]){
      g.beginPath();for(let i=0;i<COUNT;i++){
        const x=cx+side*targets[i]*scale,y=base-height*i/(COUNT-1);
        if(i===0)g.moveTo(x,y);else g.lineTo(x,y);
      }g.stroke();
    }
    const rt=targets[COUNT-1]*scale;
    g.beginPath();g.ellipse(cx,top,rt,rt*.17,0,0,Math.PI*2);g.stroke();g.restore();
  }
  function drawReference() {
    const w=refCanvas.width,h=refCanvas.height;
    refCtx.clearRect(0,0,w,h);
    refCtx.fillStyle='#f4ecdf';refCtx.beginPath();refCtx.ellipse(w*.5,h*.87,83,12,0,0,Math.PI*2);refCtx.fill();
    drawVessel(refCtx,targets,'clay',w*.5,h*.86,[.50,.66,.75,.75,.61][stageIndex]*h,70,{silhouette:true,shadow:false});
  }
  function drawMini(c,profile,color,stage=stageIndex){
    const g=c.getContext('2d');const w=c.width,h=c.height;
    g.clearRect(0,0,w,h);
    g.fillStyle='rgba(106,78,60,.10)';g.beginPath();g.ellipse(w/2,h*.88,w*.32,h*.043,0,0,Math.PI*2);g.fill();
    drawVessel(g,profile,color,w/2,h*.87,[.50,.62,.74,.74,.62][stage]*h,Math.min(w*.31,h*.42),{phase:0});
  }
  function imageFor(profile,color,stage){const c=document.createElement('canvas');c.width=220;c.height=175;drawMini(c,profile,color,stage);return c.toDataURL('image/png');}
  function updateShape(delta,t){
    for(let i=0;i<COUNT;i++){
      const di=(i/(COUNT-1)-t)/.078;
      const influence=Math.exp(-.5*di*di);
      const foothold=.25+.75*Math.min(1,(i/(COUNT-1))/.07);
      current[i]=clamp(current[i]+delta*influence*foothold,.28,1.17);
    }
    updateFit();
  }
  function pointerCoords(e){const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
  function onPointerDown(e){
    if(!started || modalKind || (e.pointerType==='mouse'&&e.button!==0)||dragging)return;
    const {x,y}=pointerCoords(e);
    if(y<view.top-24||y>view.bottom+18||Math.abs(x-view.center)>view.scale*1.35+25)return;
    dragging=true;pointerId=e.pointerId;dragChanged=false;dragStartProfile=current.slice();
    dragSide=x<view.center?-1:1;editY=clamp((view.bottom-y)/view.height,0,1);
    canvas.setPointerCapture(e.pointerId);
    canvas.dataset.lastX=String(x);
    $('canvasHint').classList.remove('visible');
    e.preventDefault();
  }
  function onPointerMove(e){
    if(!dragging||e.pointerId!==pointerId)return;
    const{x,y}=pointerCoords(e);
    const dx=x-Number(canvas.dataset.lastX||x);
    canvas.dataset.lastX=String(x);
    editY=clamp((view.bottom-y)/view.height,0,1);
    if(dx!==0){updateShape(clamp(dx*dragSide/view.scale*1.0,-.12,.12),editY);dragChanged=true;firstDrag=true;}
    e.preventDefault();
  }
  function onPointerUp(e){
    if(!dragging||e.pointerId!==pointerId)return;
    dragging=false;pointerId=null;
    if(dragChanged){ history.push(dragStartProfile);if(history.length>25)history.shift();updateButtons();playTone(260,.045); }
    dragChanged=false;
  }
  function undo(){if(!history.length)return;current=history.pop();updateFit();updateButtons();playTone(250,.06);}
  function reset(){if(!started||modalKind)return; if(current.every((v,i)=>Math.abs(v-initialForStage()[i])<.0001)){showToast('まだ粘土には触っていないよ');return;}
    history.push(current.slice());if(history.length>25)history.shift();current=initialForStage().slice();updateFit();updateButtons();showToast('最初の粘土に戻しました');playTone(240,.07);
  }
  function onCanvasKey(e){
    if(!started||modalKind||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;
    e.preventDefault();
    if(e.key==='ArrowUp'||e.key==='ArrowDown'){editY=clamp(editY+(e.key==='ArrowUp'?.045:-.045),0,1);return;}
    history.push(current.slice());if(history.length>25)history.shift();
    updateShape((e.key==='ArrowRight'?1:-1)*(e.shiftKey?.075:.033),editY);updateButtons();
    firstDrag=true;$('canvasHint').classList.remove('visible');playTone(290,.035);
  }
  function openModal(kind,html,setup){
    modalKind=kind;modalInner.innerHTML=html;modalEl.style.display='grid';
    $('modal').scrollTop=0;
    if(setup)setup();
    requestAnimationFrame(()=>$('modal').focus());
  }
  function closeModal(){modalKind='';modalEl.style.display='none';canvas.focus({preventScroll:true});}
  function begin(){started=true;setStage(0);closeModal();showToast('器のふちを左右にドラッグしてみよう');$('canvasHint').classList.add('visible');playTone(392,.12);}
  function startStage(i){started=true;setStage(i);closeModal();playTone(392,.10);}
  function openIntro(){
    openModal('intro',`<div class="modal-ornament">✳　土と、ちいさなひととき。</div>
      <div class="modal-kicker">WELCOME TO THE POTTERY STUDIO</div>
      <h2 id="modalTitle">ろくろ日和へ<br>ようこそ。</h2>
      <p>くるくる回る粘土を、指先で自由にかたちづくろう。<br>5つのお題に挑戦する、のんびり陶芸ゲームです。</p>
      <div class="welcome-preview"><canvas id="welcomeCanvas" width="370" height="200" role="img" aria-label="陶器のイメージ"></canvas></div>
      <div class="welcome-steps"><div class="welcome-step"><b>↔</b>粘土をひっぱる</div><div class="welcome-step"><b>✧</b>かたちを整える</div><div class="welcome-step"><b>◎</b>作品を焼き上げる</div></div>
      <button id="startButton" class="primary-button modal-button">ろくろを回してみる <span class="button-arrow">→</span></button>
      <button id="introGallery" class="modal-subbutton">作品棚を見る</button>`,()=>{
        drawMini($('welcomeCanvas'),makeShape(stages[2].knots),'clay',2);
        $('startButton').addEventListener('click',begin);
        $('introGallery').addEventListener('click',openGallery);
      });
  }
  function openHelp(){
    openModal('help',`<div class="modal-kicker">HOW TO PLAY</div><h2 id="modalTitle">あそびかた</h2>
      <p>お手本を見ながら粘土の形を変えて、5つの器をつくりましょう。制限時間はありません。</p>
      <div class="help-illustration"><strong>←　器　→</strong><span>器に触れたまま左右へ動かす</span></div>
      <p>器の右側を右へ引く（左側なら左へ引く）と<strong>ふくらみ</strong>、中心に向かって押すと<strong>細く</strong>なります。高さを変えてドラッグすると、好きな場所を加工できます。</p>
      <p>点線はお手本の形。色を選んで「完成させる」を押すと、似ている度合いが採点されます。作品棚には各お題の最高得点作品が保存されます。</p>
      <p>PCではキャンバスを選択して、↑↓で加工位置、←→で太さを操作できます。Shift＋←→で大きく変更できます。</p>
      <button id="closeHelp" class="primary-button modal-button">${started?'ろくろに戻る':'遊んでみる'} →</button>`,()=>{
        $('closeHelp').addEventListener('click',()=>{if(started)closeModal();else openIntro();});
      });
  }
  function finish(){
    if(!started||modalKind)return;
    const score=scoreShape(current),best=gallery[stageIndex]?.score??-1;
    const isRecord=score>best;
    if(isRecord){gallery[stageIndex]={shape:current.map(v=>Math.round(v*1000)/1000),glaze,score,date:new Date().toISOString()};saveGallery();}
    successSound();
    const rank=score>=96?'伝説のろくろ職人！':score>=88?'名人の仕上がり！':score>=76?'すてきな一品！':score>=60?'味わい深い作品！':'個性あふれる作品！';
    const note=score>=88?'お手本そっくり。見事な指先です。':score>=70?'かなり近づきました！ 次はもっと上を目指そう。':'手づくりならではの形。何度でも挑戦できるよ。';
    const last=stageIndex===stages.length-1;
    openModal('result',`<div class="modal-kicker">${last?'FINAL PIECE':'POTTERY COMPLETE'} · ${String(stageIndex+1).padStart(2,'0')}/${stages.length}</div>
      <div class="result-score"><strong>${score}<span>点</span></strong><div class="result-rank">${rank}</div></div>
      <div class="result-art"><canvas id="resultCanvas" width="290" height="215" aria-label="完成した器"></canvas></div>
      <h2 id="modalTitle" style="text-align:center;font-size:25px;margin:3px 0 8px">${stages[stageIndex].short}、完成。</h2>
      <p class="result-note">${note}</p>
      <div class="result-best">${isRecord?'✧ このお題のベストスコアを更新！':`このお題のベスト：${best} 点`}</div>
      <div class="result-actions"><button id="nextButton" class="primary-button modal-button">${last?'作品棚を見に行く':'次のお題へ進む'} <span class="button-arrow">→</span></button>
      <button id="retryButton" class="modal-subbutton">同じお題にもう一度挑戦</button></div>`,()=>{
        drawMini($('resultCanvas'),current,glaze);
        $('nextButton').addEventListener('click',()=>last?openGallery():startStage(stageIndex+1));
        $('retryButton').addEventListener('click',()=>startStage(stageIndex));
      });
  }
  function openGallery(){
    const entries=Object.keys(gallery).map(Number).sort((a,b)=>a-b);
    let content='';
    if(entries.length){
      content=`<div class="gallery-grid">${entries.map(i=>{
        const item=gallery[i],alt=`${stages[i].short}の作品`;
        return `<div class="gallery-item"><img alt="${alt}" src="${imageFor(item.shape,item.glaze,i)}"><strong>${stages[i].short}</strong><small>BEST ${item.score}点 · ${glazes[item.glaze].name}</small></div>`;
      }).join('')}</div><p class="gallery-note">各お題のベスト作品を、この端末に保存しています。</p>`;
    } else {content='<div class="gallery-empty"><div class="large-symbol">♧</div><p>作品棚は、まだ空っぽ。<br>最初の一品を作ってみよう。</p></div>';}
    openModal('gallery',`<div class="modal-kicker">MY POTTERY COLLECTION</div><h2 id="modalTitle">わたしの作品棚。</h2>${content}
      <button id="galleryClose" class="primary-button modal-button">${started?'ろくろに戻る':'ろくろをはじめる'} →</button>
      ${entries.length?'<button id="restartJourney" class="modal-subbutton">最初のお題から遊ぶ</button>':''}`,()=>{
        $('galleryClose').addEventListener('click',()=>{if(started)closeModal();else begin();});
        $('restartJourney')?.addEventListener('click',()=>startStage(0));
      });
  }
  function tick(now){
    const dt=lastTime?Math.min(.12,(now-lastTime)/1000):0;lastTime=now;
    if(started&&!modalKind&&!document.hidden){seconds+=dt;if(Math.floor(seconds)!==Math.floor(seconds-dt))updateClock();}
    if(now-lastRender>=1000/45){drawScene(now);lastRender=now;}
    requestAnimationFrame(tick);
  }
  canvas.addEventListener('pointerdown',onPointerDown);
  canvas.addEventListener('pointermove',onPointerMove);
  canvas.addEventListener('pointerup',onPointerUp);
  canvas.addEventListener('pointercancel',onPointerUp);
  canvas.addEventListener('lostpointercapture',e=>{if(dragging)onPointerUp(e);});
  canvas.addEventListener('keydown',onCanvasKey);
  $('undoButton').addEventListener('click',undo);
  $('resetButton').addEventListener('click',reset);
  $('finishButton').addEventListener('click',finish);
  $('guideButton').addEventListener('click',()=>{
    guide=!guide;$('guideButton').setAttribute('aria-pressed',String(guide));
    $('guideButton').textContent=`${guide?'◉ お手本ライン ON':'○ お手本ライン OFF'}`;
  });
  $('glazes').addEventListener('click',e=>{
    const btn=e.target.closest('[data-glaze]');if(!btn)return;
    glaze=btn.dataset.glaze;
    $('glazes').querySelectorAll('[data-glaze]').forEach(el=>{
      const selected=el===btn;el.classList.toggle('selected',selected);el.setAttribute('aria-pressed',String(selected));
    });
    $('glazeName').innerHTML=glazes[glaze].name+' <span>— '+glazes[glaze].caption+'</span>';
    playTone(350,.08);
  });
  $('soundButton').addEventListener('click',()=>{sound=!sound;updateSound();playTone(440,.10);});
  $('galleryButton').addEventListener('click',openGallery);
  $('helpButton').addEventListener('click',openHelp);
  window.addEventListener('resize',resize,{passive:true});
  if('ResizeObserver' in window)new ResizeObserver(resize).observe(canvas);
  document.addEventListener('visibilitychange',()=>{lastTime=0;});
  // Modal intentionally does not close on backdrop/Escape during a finished piece,
  // preventing an accidental skip of the result and next-stage action.
  setStage(0);updateSound();resize();openIntro();requestAnimationFrame(tick);
})();
