const $=s=>document.querySelector(s);
const canvas=$("#gameCanvas"),ctx=canvas.getContext("2d");
const audio=$("#audio"), input=$("#musicInput");
const state={
  file:null,url:null,playing:false,paused:false,dead:false,
  score:0,combo:0,bestCombo:0,hitBeats:0,high:Number(localStorage.getItem("dinoHighScore")||0),
  speed:7,baseSpeed:7,gravity:2100,jump:-760,dino:{x:70,y:0,w:44,h:48,vy:0,onGround:true},
  obstacles:[],particles:[],clouds:[],last:0,beatTimes:[],beatIndex:0,lastBeat:-1,beatPulse:0,
  bpm:120, audioCtx:null, analyser:null, source:null, data:null, prevData:null, energyHistory:[], fluxHistory:[], detector:null, lastAutoBeat:-10, autoIntervals:[], autoLastPeak:null,
  manualTimer:null, duration:0,startedAt:0,raf:null
};
$("#highScore").textContent=fmt(state.high);

function fmt(n){return String(Math.floor(n)).padStart(6,"0")}
function resize(){const r=canvas.getBoundingClientRect(),d=devicePixelRatio||1;canvas.width=r.width*d;canvas.height=r.height*d;ctx.setTransform(d,0,0,d,0,0);state.dino.x=Math.max(40,r.width*.08)}
addEventListener("resize",resize); resize();

input.addEventListener("change",()=>{
  const f=input.files[0]; if(!f)return;
  state.file=f;if(state.url)URL.revokeObjectURL(state.url);state.url=URL.createObjectURL(f);
  audio.src=state.url; $("#fileName").textContent=f.name;$("#songTitle").textContent=f.name;$("#songMeta").textContent=(f.type||"audio").replace("audio/","").toUpperCase();
  $("#songInfo").classList.remove("hidden");$("#startBtn").disabled=false;$("#startBtn").textContent="COMEÇAR JOGO";
  audio.addEventListener("loadedmetadata",()=>{$("#timeLabel").textContent=`0:00 / ${clock(audio.duration)}`},{once:true});
});
$("#removeSong").onclick=()=>{audio.pause();input.value="";state.file=null;state.url=null;$("#songInfo").classList.add("hidden");$("#fileName").textContent="Escolher música";$("#startBtn").disabled=true;$("#startBtn").textContent="ESCOLHA UMA MÚSICA"};
$("#syncMode").onchange=e=>{$("#bpmSettings").classList.toggle("hidden",e.target.value!=="bpm");$("#manualSettings").classList.toggle("hidden",e.target.value!=="manual")};

function setupAudio(){
  if(state.audioCtx)return;
  state.audioCtx=new (AudioContext||webkitAudioContext)();
  state.analyser=state.audioCtx.createAnalyser();state.analyser.fftSize=1024;state.analyser.smoothingTimeConstant=.72;
  state.data=new Uint8Array(state.analyser.frequencyBinCount);state.prevData=new Uint8Array(state.analyser.frequencyBinCount);
  state.source=state.audioCtx.createMediaElementSource(audio);state.source.connect(state.analyser);state.analyser.connect(state.audioCtx.destination);
}
async function start(){
  setupAudio();await state.audioCtx.resume(); audio.currentTime=0;
  state.score=0;state.combo=0;state.bestCombo=0;state.hitBeats=0;state.obstacles=[];state.particles=[];state.beatIndex=0;state.lastBeat=-1;state.dead=false;state.paused=false;state.energyHistory=[];state.fluxHistory=[];state.detector=null;state.lastAutoBeat=-10;state.autoIntervals=[];state.autoLastPeak=null;state.bpm=120;
  state.dino.y=ground()-state.dino.h;state.dino.vy=0;state.dino.onGround=true;
  const mode=$("#syncMode").value;
  if(mode==="bpm"){state.bpm=clamp(+$("#bpmInput").value||120,40,240);buildBpmBeats();}
  else if(mode==="manual"){buildManualBeats();}
  else {state.beatTimes=[];state.bpm=120}
  $("#menu").classList.remove("active");$("#game").classList.add("active");resize();
  $("#startOverlay").classList.remove("hidden");let n=3;$("#countdown").textContent=n;
  const timer=setInterval(()=>{n--;if(n>0)$("#countdown").textContent=n;else{$("#startOverlay").classList.add("hidden");clearInterval(timer);play();}},700);
}
function play(){audio.play();state.playing=true;state.startedAt=performance.now();state.last=performance.now();state.raf=requestAnimationFrame(loop)}
$("#startBtn").onclick=start;
$("#retryBtn").onclick=()=>start();
$("#menuBtn").onclick=()=>{audio.pause();cancelAnimationFrame(state.raf);$("#game").classList.remove("active");$("#menu").classList.add("active")};
$("#pauseBtn").onclick=togglePause;$("#resumeBtn").onclick=togglePause;
$("#quitBtn").onclick=()=>{$("#menuBtn").click()};
function togglePause(){if(state.dead)return;state.paused=!state.paused;$("#pauseOverlay").classList.toggle("hidden",!state.paused);if(state.paused){audio.pause();}else{audio.play();state.last=performance.now();state.raf=requestAnimationFrame(loop)}}
addEventListener("keydown",e=>{if((e.code==="Space"||e.code==="ArrowUp")&&$("#game").classList.contains("active")){e.preventDefault();state.jumpHeld=true;jump()}});
addEventListener("keyup",e=>{if(e.code==="Space"||e.code==="ArrowUp")state.jumpHeld=false});
canvas.addEventListener("pointerdown",()=>{if($("#game").classList.contains("active")&&!state.paused&&!state.dead){state.jumpHeld=true;jump()}});
canvas.addEventListener("pointerup",()=>state.jumpHeld=false);canvas.addEventListener("pointercancel",()=>state.jumpHeld=false);
function jump(){state.jumpBuffer=.12;if(state.dino.onGround||state.coyote>0){state.dino.vy=state.jump;state.dino.onGround=false;state.coyote=0;state.jumpBuffer=0;burst(state.dino.x+20,ground()-5,7)}}
function ground(){return canvas.clientHeight-55}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function clock(s){if(!isFinite(s))return"0:00";return`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`}

function buildBpmBeats(){const d=audio.duration||180,step=60/state.bpm,off=(+$("#offsetInput").value||0)/1000;state.beatTimes=[];for(let t=Math.max(.05,off);t<d+.5;t+=step)state.beatTimes.push(t)}
function buildManualBeats(){const off=(+$("#manualOffset").value||0)/1000;state.beatTimes=($("#beatsInput").value||"").split(",").map(Number).filter(Number.isFinite).map(x=>x+off).filter(x=>x>=0).sort((a,b)=>a-b);state.bpm=estimateBpm(state.beatTimes)}
function estimateBpm(a){if(a.length<3)return 120;let sum=0;for(let i=1;i<a.length;i++)sum+=a[i]-a[i-1];return clamp(60/(sum/(a.length-1)),40,240)}

function detectAuto(){
  state.analyser.getByteFrequencyData(state.data);
  // Detecta mudanças rápidas de energia, dando mais peso aos graves/low-mid.
  let energy=0, flux=0, weightSum=0;
  const maxBin=Math.min(45,state.data.length);
  for(let i=1;i<maxBin;i++){
    const weight=i<16?1.9:(i<30?1.2:.7);
    energy+=state.data[i]*weight;
    flux+=Math.max(0,state.data[i]-state.prevData[i])*weight;
    weightSum+=weight;
  }
  energy/=weightSum; flux/=weightSum;
  state.energyHistory.push(energy);state.fluxHistory.push(flux);
  if(state.energyHistory.length>90)state.energyHistory.shift();
  if(state.fluxHistory.length>90)state.fluxHistory.shift();
  state.data.forEach((v,i)=>state.prevData[i]=v);

  if(state.energyHistory.length<18)return false;
  const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
  const em=mean(state.energyHistory), fm=mean(state.fluxHistory);
  const es=Math.sqrt(mean(state.energyHistory.map(v=>(v-em)**2)));
  const fs=Math.sqrt(mean(state.fluxHistory.map(v=>(v-fm)**2)));
  const t=audio.currentTime;
  // Combina energia sustentada e ataque/transiente; cooldown evita vários spawns na mesma batida.
  const energyHit=energy>em+Math.max(5,es*1.05);
  const fluxHit=flux>fm+Math.max(2,fs*1.35);
  const strong=energy>em*1.12 && flux>fm*1.05;
  if((energyHit&&fluxHit)||strong){
    if(t-state.lastAutoBeat>.22){
      if(state.autoLastPeak!=null){
        const gap=t-state.autoLastPeak;
        if(gap>.22&&gap<1.2)state.autoIntervals.push(gap);
        if(state.autoIntervals.length>10)state.autoIntervals.shift();
        if(state.autoIntervals.length>=3){
          const avg=state.autoIntervals.reduce((a,b)=>a+b,0)/state.autoIntervals.length;
          state.bpm=clamp(60/avg,60,190);
        }
      }
      state.autoLastPeak=t;state.lastAutoBeat=t;return true;
    }
  }
  return false;
}
function beatNow(){
  const t=audio.currentTime,mode=$("#syncMode").value;
  if(mode==="auto")return detectAuto();
  while(state.beatIndex<state.beatTimes.length&&state.beatTimes[state.beatIndex]<t-.12)state.beatIndex++;
  if(state.beatIndex<state.beatTimes.length&&Math.abs(state.beatTimes[state.beatIndex]-t)<.075){state.beatIndex++;return true}
  return false;
}
function onBeat(){
  if(state.lastBeat===Math.floor(audio.currentTime*10))return;
  state.lastBeat=Math.floor(audio.currentTime*10);state.beatPulse=1;
  if($("#flashToggle").checked){$("#flash").classList.remove("flash");void $("#flash").offsetWidth;$("#flash").classList.add("flash")}
  spawnObstacle();
}
function spawnObstacle(){
  const last=state.obstacles[state.obstacles.length-1];
  const minGap=Math.max(145,state.speed*22);
  if(last&&last.x>canvas.clientWidth+25-minGap)return;
  const r=Math.random(),type=r>.88?"tall":r>.68?"double":"single";
  const h=type==="tall"?58:type==="double"?40:32,w=type==="double"?54:28;
  state.obstacles.push({x:canvas.clientWidth+25,y:ground()-h,w,h,type,passed:false});
}
function loop(now){
  if(state.dead||state.paused)return;
  const dt=Math.min(.032,(now-state.last)/1000);state.last=now;
  if(audio.ended){endGame();return}
  if(beatNow())onBeat();
  update(dt);draw();
  const p=audio.duration?audio.currentTime/audio.duration:0;$("#songProgress").style.width=`${p*100}%`;$("#timeLabel").textContent=`${clock(audio.currentTime)} / ${clock(audio.duration)}`;
  $("#score").textContent=fmt(state.score);$("#combo").textContent=`x${state.combo}`;$("#beatFill").style.width=`${state.beatPulse*100}%`;$("#bpmLabel").textContent=`BPM ${Math.round(state.bpm)}`;
  state.beatPulse*=.90;
  state.raf=requestAnimationFrame(loop)
}
function update(dt){
  const mult={easy:.82,normal:1,hard:1.18,insane:1.4}[$("#difficulty").value]||1;
  state.speed=(state.baseSpeed+Math.min(8,audio.currentTime*.12))*mult;
  state.jumpBuffer=Math.max(0,state.jumpBuffer-dt);
  if(state.dino.onGround)state.coyote=.10;else state.coyote=Math.max(0,state.coyote-dt);
  state.dino.vy+=state.gravity*dt;
  // Soltar o pulo cedo reduz a altura, deixando a física mais responsiva.
  if(!state.jumpHeld&&state.dino.vy< -260)state.dino.vy+=state.gravity*1.25*dt;
  state.dino.y+=state.dino.vy*dt;
  const g=ground()-state.dino.h;
  if(state.dino.y>=g){
    const wasAir=!state.dino.onGround;
    state.dino.y=g;state.dino.vy=0;state.dino.onGround=true;state.dino.airTime=0;state.dino.landSquash=wasAir?1:.15;
    if(wasAir)burst(state.dino.x+20,g+state.dino.h,8);
  }else{state.dino.onGround=false;state.dino.airTime+=dt}
  state.dino.landSquash=Math.max(0,state.dino.landSquash-dt*4);
  if(state.jumpBuffer>0&&(state.dino.onGround||state.coyote>0))jump();
  for(const o of state.obstacles)o.x-=state.speed*60*dt;
  for(const o of state.obstacles){
    if(!o.passed&&o.x+o.w<state.dino.x){o.passed=true;state.combo++;state.bestCombo=Math.max(state.bestCombo,state.combo);state.hitBeats++;state.score+=100+state.combo*10}
    if(hit(state.dino,o)){state.combo=0;endGame();return}
  }
  state.obstacles=state.obstacles.filter(o=>o.x>-80);state.score+=Math.floor(dt*8);
  state.particles.forEach(p=>{p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=500*dt;p.life-=dt});state.particles=state.particles.filter(p=>p.life>0)
}
function hit(a,b){const ax=a.x+8,ay=a.y+5,aw=a.w-14,ah=a.h-8;return ax<b.x+b.w&&ax+aw>b.x&&ay<b.y+b.h&&ay+ah>b.y}
function burst(x,y,n){for(let i=0;i<n;i++)state.particles.push({x,y,vx:(Math.random()-.5)*180,vy:-Math.random()*170,life:.5})}

function draw(){
  const w=canvas.clientWidth,h=canvas.clientHeight,g=ground();ctx.clearRect(0,0,w,h);
  const grad=ctx.createLinearGradient(0,0,0,h);grad.addColorStop(0,"#09060a");grad.addColorStop(1,"#190711");ctx.fillStyle=grad;ctx.fillRect(0,0,w,h);
  drawStars(w,h); if($("#visualizerToggle").checked)drawVisualizer(w,h);
  ctx.strokeStyle="rgba(255,79,154,.25)";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,g+1);ctx.lineTo(w,g+1);ctx.stroke();
  ctx.fillStyle="rgba(255,79,154,.08)";ctx.fillRect(0,g+3,w,h-g);
  state.obstacles.forEach(drawObstacle);drawDino(state.dino.x,state.dino.y,state.dino.w,state.dino.h);
  state.particles.forEach(p=>{ctx.globalAlpha=Math.max(0,p.life*2);ctx.fillStyle="#ff78b5";ctx.fillRect(p.x,p.y,3,3)});ctx.globalAlpha=1
}
function drawStars(w,h){for(let i=0;i<35;i++){let x=(i*97+31)%w,y=(i*53+18)%(h*.62);ctx.fillStyle=i%5===0?"#ff7eb9":"#5d3445";ctx.fillRect(x,y,2,2)}}
function drawVisualizer(w,h){if(!state.analyser)return;state.analyser.getByteFrequencyData(state.data);const bars=36,bw=w/bars;for(let i=0;i<bars;i++){const v=(state.data[i*3]||0)/255;ctx.fillStyle="rgba(255,79,154,.18)";ctx.fillRect(i*bw,h-10-v*45,bw-2,v*45)}}
function drawDino(x,y,w,h){
  ctx.save();
  const squash=state.dino.landSquash;
  ctx.translate(x+22,y+48);ctx.scale(1+squash*.12,1-squash*.10);ctx.translate(-22,-48);ctx.fillStyle="#f8edf2";
  // corpo pixel-art original
  ctx.fillRect(9,15,25,25);ctx.fillRect(18,7,22,22);ctx.fillRect(31,2,12,17);ctx.fillRect(39,7,7,6);
  ctx.fillRect(13,38,7,10);ctx.fillRect(29,38,7,10);ctx.fillRect(3,22,9,7);
  ctx.fillStyle="#17070d";ctx.fillRect(38,8,3,3);
  ctx.fillStyle="#ff4f9a";ctx.fillRect(18,20,6,4);ctx.fillRect(7,30,7,3);
  ctx.restore()
}
function drawObstacle(o){
  ctx.save();ctx.fillStyle="#ff4f9a";ctx.shadowBlur=10;ctx.shadowColor="#ff4f9a";
  ctx.fillRect(o.x,o.y+7,o.w,o.h-7);ctx.fillRect(o.x+o.w*.32,o.y,o.w*.35,9);
  ctx.fillStyle="#6e0928";ctx.fillRect(o.x+5,o.y+12,4,8);ctx.fillRect(o.x+o.w-9,o.y+23,4,8);ctx.restore()
}
function endGame(){
  if(state.dead)return;state.dead=true;state.playing=false;audio.pause();cancelAnimationFrame(state.raf);
  const old=state.high,isNew=state.score>old;if(isNew){state.high=state.score;localStorage.setItem("dinoHighScore",state.high)}
  $("#finalScore").textContent=fmt(state.score);$("#newRecord").textContent=isNew?"🏆 NOVO RECORDE!":`Recorde: ${fmt(state.high)}`;$("#hitBeats").textContent=state.hitBeats;$("#bestCombo").textContent=state.bestCombo;$("#highScore").textContent=fmt(state.high);$("#gameOverOverlay").classList.remove("hidden")
}
$("#retryBtn").onclick=()=>{$("#gameOverOverlay").classList.add("hidden");start()};

$("#themeBtn").onclick=()=>document.body.classList.toggle("bright");
document.addEventListener("visibilitychange",()=>{if(document.hidden&&state.playing&&!state.paused)togglePause()});
