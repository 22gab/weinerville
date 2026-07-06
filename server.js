const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");
const app = express();
app.use(express.static("."));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const WORLD_W=2500, WORLD_H=1600, RAD=20;
const MAX_AMMO=30;
const MAX_PELLETS=26;
const buildings=[
  {x:400,y:300,w:280,h:180},{x:1200,y:250,w:220,h:220},{x:1900,y:350,w:300,h:160},
  {x:300,y:900,w:200,h:260},{x:900,y:800,w:340,h:180},{x:1500,y:950,w:200,h:200},
  {x:2050,y:900,w:240,h:260},{x:750,y:1250,w:260,h:180},{x:1650,y:1300,w:300,h:160}
];
let players = {};
let bullets = [];
let pellets = [];
let nextId = 1;
let bulletId = 1;
let pelletId = 1;
const BOT_NAMES = ["Frankie","Sizzle","Linky","Duke","Wurst","BratBob","Chorizo"];
const MATCH_TIME = 120;
let matchTimer = MATCH_TIME;
let phase = "playing";
let overTimer = 0;
let lastRank = [];
const TICK = 1/30;
function inBuilding(x,y,m){ m=m||0; for(const b of buildings){ if(x>b.x-m&&x<b.x+b.w+m&&y>b.y-m&&y<b.y+b.h+m) return true; } return false; }
function freeSpot(){ for(let i=0;i<100;i++){ const x=100+Math.random()*(WORLD_W-200), y=100+Math.random()*(WORLD_H-200); if(!inBuilding(x,y,40)) return {x,y}; } return {x:WORLD_W/2,y:WORLD_H/2}; }
function spawn(p){ const s=freeSpot(); p.x=s.x; p.y=s.y; p.hp=100; p.dead=false; p.ammo=MAX_AMMO; }
function resolve(p){ for(const b of buildings){ const nx=Math.max(b.x,Math.min(p.x,b.x+b.w)), ny=Math.max(b.y,Math.min(p.y,b.y+b.h)); const dx=p.x-nx, dy=p.y-ny, d2=dx*dx+dy*dy; if(d2<RAD*RAD){ const d=Math.sqrt(d2)||0.01; p.x+=dx/d*(RAD-d); p.y+=dy/d*(RAD-d); } } p.x=Math.max(RAD,Math.min(WORLD_W-RAD,p.x)); p.y=Math.max(RAD,Math.min(WORLD_H-RAD,p.y)); }
function fire(owner, ox, oy, ang){ bullets.push({ id: bulletId++, owner, x: ox, y: oy, vx: Math.cos(ang)*600, vy: Math.sin(ang)*600, life: 1.2 }); }
function spawnPellet(){ const s=freeSpot(); pellets.push({ id:pelletId++, x:s.x, y:s.y, amt:6 }); }
for(let i=0;i<MAX_PELLETS;i++) spawnPellet();
const BOTS = 4;
for (let i=0;i<BOTS;i++){ const id="bot"+(i+1); const p={ x:0,y:0,a:0,hp:100,dead:false,score:0,ammo:MAX_AMMO,name:BOT_NAMES[i%BOT_NAMES.length],bot:true,tx:0,ty:0,shootCd:0,wanderCd:0 }; spawn(p); players[id]=p; }
function newMatch(){ matchTimer=MATCH_TIME; phase="playing"; for(const id in players){ players[id].score=0; spawn(players[id]); } bullets=[]; pellets=[]; for(let i=0;i<MAX_PELLETS;i++) spawnPellet(); }
wss.on("connection", (ws) => {
  const id = "p" + (nextId++);
  const p = { x:0, y:0, a:0, hp:100, dead:false, score:0, ammo:MAX_AMMO, name:"DOG" };
  spawn(p);
  players[id] = p;
  ws.send(JSON.stringify({ type: "welcome", id, buildings }));
  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      const me = players[id];
      if (!me) return;
      if (data.type === "name") { me.name = (""+data.name).slice(0,12); }
      if (me.dead || phase!=="playing") return;
      if (data.type === "move") { me.x=data.x; me.y=data.y; me.a=data.a; resolve(me); }
      if (data.type === "shoot") { if(me.ammo>0){ me.ammo--; fire(id, data.x, data.y, data.a); } }
    } catch (e) {}
  });
  ws.on("close", () => { delete players[id]; });
});
function pickPellets(p){ for(let i=pellets.length-1;i>=0;i--){ const pe=pellets[i]; if(Math.hypot(pe.x-p.x,pe.y-p.y)<28){ p.ammo=Math.min(MAX_AMMO,p.ammo+pe.amt); pellets.splice(i,1); } } }
function updateBots(dt){
  if (phase!=="playing") return;
  for (const id in players){
    const b = players[id];
    if (!b.bot || b.dead) continue;
    let target=null, td=1e9;
    for (const oid in players){ const o=players[oid]; if (oid===id||o.dead) continue; const d=Math.hypot(o.x-b.x,o.y-b.y); if (d<td){ td=d; target=o; } }
    if (target && td<820 && b.ammo>0){
      const desired = Math.atan2(target.y-b.y, target.x-b.x);
      b.a = desired;
      const spd = 215*dt;
      if (td>230){ b.x += Math.cos(b.a)*spd; b.y += Math.sin(b.a)*spd; }
      else if (td<150){ b.x -= Math.cos(b.a)*spd; b.y -= Math.sin(b.a)*spd; }
      else { b.x += Math.cos(b.a+1.57)*spd*0.6; b.y += Math.sin(b.a+1.57)*spd*0.6; }
      b.shootCd -= dt;
      if (b.shootCd<=0){ b.ammo--; fire(id, b.x, b.y, b.a + (Math.random()-0.5)*0.10); b.shootCd = 0.32 + Math.random()*0.28; }
    } else {
      let pt=null, pd=1e9;
      for(const pe of pellets){ const d=Math.hypot(pe.x-b.x,pe.y-b.y); if(d<pd){pd=d;pt=pe;} }
      if(b.ammo<12 && pt){ b.tx=pt.x; b.ty=pt.y; }
      else { b.wanderCd -= dt; if (b.wanderCd<=0){ const s=freeSpot(); b.tx=s.x; b.ty=s.y; b.wanderCd=2+Math.random()*2; } }
      const dx=b.tx-b.x, dy=b.ty-b.y, dd=Math.hypot(dx,dy)||1;
      b.a = Math.atan2(dy,dx); b.x += dx/dd*150*dt; b.y += dy/dd*150*dt;
    }
    resolve(b); pickPellets(b);
  }
}
setInterval(() => {
  const dt=TICK;
  if (phase==="playing"){
    matchTimer -= dt;
    updateBots(dt);
    for (const id in players){ const p=players[id]; if(!p.dead && !p.bot) pickPellets(p); }
    if (pellets.length<MAX_PELLETS && Math.random()<0.22) spawnPellet();
    for (let i = bullets.length - 1; i >= 0; i--) {
      const bl = bullets[i];
      bl.x += bl.vx * dt; bl.y += bl.vy * dt; bl.life -= dt;
      let gone = false;
      if (inBuilding(bl.x, bl.y)) gone = true;
      for (const id in players) {
        const p = players[id];
        if (p.dead || id === bl.owner) continue;
        if (Math.hypot(bl.x - p.x, bl.y - p.y) < 24) {
          p.hp -= 25; gone = true;
          if (p.hp <= 0) { p.dead = true; const k=players[bl.owner]; if(k){ k.score++; k.hp=Math.min(100,k.hp+25); } setTimeout(()=>{ if(players[id]&&phase==="playing") spawn(players[id]); }, 2000); }
          break;
        }
      }
      if (gone || bl.life <= 0 || bl.x<0||bl.y<0||bl.x>WORLD_W||bl.y>WORLD_H) bullets.splice(i, 1);
    }
    if (matchTimer<=0){ phase="over"; overTimer=6; lastRank = Object.values(players).map(p=>({name:p.name,score:p.score})).sort((a,b)=>b.score-a.score).slice(0,8); }
  } else { overTimer -= dt; if (overTimer<=0) newMatch(); }
  const snapshot = JSON.stringify({ type:"state", players, bullets, pellets, timer:Math.max(0,Math.ceil(matchTimer)), phase, rank:lastRank });
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(snapshot); });
}, 1000/30);
const PORT = process.env.PORT || 2567;
server.listen(PORT, () => console.log("Server acceso su http://localhost:" + PORT));
