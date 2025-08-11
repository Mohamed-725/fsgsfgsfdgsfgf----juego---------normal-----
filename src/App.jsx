import React, { useRef, useState, useEffect, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";

// 3D Tower Defense - Single file React component (preview-ready)
// - Improved architecture: enemies push their positions to a shared ref
// - Towers read enemy positions from that ref to target
// - Projectiles resolve hits via App callbacks
// - Added multiple tower types, upgrades, sell, and UI
// NOTE: requires react, react-dom, @react-three/fiber, @react-three/drei and tailwind for styling (optional)

const PATH = [
  [-8, 0, 8],
  [-4, 0, 4],
  [0, 0, 0],
  [4, 0, -4],
  [8, 0, -8],
];

function lerp(a, b, t) { return a + (b - a) * t }
function lerpVec(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)] }
function dist(a, b) { const dx = a[0] - b[0]; const dy = a[1] - b[1]; const dz = a[2] - b[2]; return Math.sqrt(dx * dx + dy * dy + dz * dz) }

const TOWER_TYPES = {
  basic: { key: 'basic', name: 'Básica', cost: 30, range: 3.5, dmg: 1, fireRate: 0.8 },
  fast:  { key: 'fast',  name: 'Rápida',  cost: 45, range: 3.0, dmg: 1, fireRate: 0.45 },
  sniper:{ key: 'sniper',name: 'Francotirador', cost: 85, range: 9.0, dmg: 5, fireRate: 1.5 },
  cannon:{ key: 'cannon',name: 'Cañón', cost: 100, range: 5.5, dmg: 2, fireRate: 1.2, splash: 2.2 },
}

// Enemy component: updates its position on each frame and writes it to enemyPositionsRef
function EnemyMesh({ id, type, hp, enemyPositionsRef, onReachEnd }){
  const ref = useRef();
  const progress = useRef(0);
  const baseSpeed = (type === 'fast') ? 1.2 : (type === 'cannon' ? 0.45 : 0.7);

  useEffect(()=>{
    // set initial pos
    if(ref.current) ref.current.position.set(...PATH[0]);
  },[]);

  useFrame((_, dt) => {
    progress.current += baseSpeed * dt;
    const idx = Math.floor(progress.current);
    const t = progress.current - idx;
    if(idx >= PATH.length - 1){
      // reached end
      enemyPositionsRef.current.delete(id);
      onReachEnd(id);
      return;
    }
    const pos = lerpVec(PATH[idx], PATH[idx + 1], t);
    if(ref.current) ref.current.position.set(...pos);
    // publish current position; hp will be read from outer state when needed
    enemyPositionsRef.current.set(id, { pos, hp });
  });

  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.45, 12, 12]} />
      <meshStandardMaterial color={ type === 'fast' ? 'orange' : type === 'cannon' ? 'purple' : 'red' } />
    </mesh>
  )
}

// Projectile component: moves toward the *current* target position (reads enemyPositionsRef)
function ProjectileMesh({ id, from, targetId, enemyPositionsRef, onHit, splash }){
  const ref = useRef();
  const speed = 12;

  useEffect(()=>{ if(ref.current) ref.current.position.set(...from) },[from]);

  useFrame((_, dt) => {
    const target = enemyPositionsRef.current.get(targetId);
    const to = target ? target.pos : null;
    if(!to){
      // target vanished: remove projectile
      onHit(id, null);
      return;
    }
    const dir = [ to[0] - ref.current.position.x, to[1] - ref.current.position.y, to[2] - ref.current.position.z ];
    const len = Math.max(0.0001, Math.sqrt(dir[0]*dir[0] + dir[1]*dir[1] + dir[2]*dir[2]));
    ref.current.position.x += (dir[0]/len) * speed * dt;
    ref.current.position.y += (dir[1]/len) * speed * dt;
    ref.current.position.z += (dir[2]/len) * speed * dt;

    const d = Math.sqrt(Math.pow(ref.current.position.x - to[0],2) + Math.pow(ref.current.position.z - to[2],2));
    if(d < 0.6){
      onHit(id, { targetId, splash, hitPos: [ref.current.position.x, ref.current.position.y, ref.current.position.z] });
    }
  });

  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.12, 8, 8]} />
      <meshStandardMaterial color={'#ffe27a'} />
    </mesh>
  )
}

// Tower: checks enemyPositionsRef for targets and spawns projectiles via callback
function TowerMesh({ tower, enemyPositionsRef, spawnProjectile }){
  const lastShot = useRef(0);
  const config = TOWER_TYPES[tower.type] || TOWER_TYPES.basic;

  useFrame((_, dt) => {
    lastShot.current += dt;
    const fireInterval = Math.max(0.12, config.fireRate);
    if(lastShot.current < fireInterval) return;

    // find nearest enemy within range
    let closest = null; let minD = Infinity;
    for(const [id, info] of enemyPositionsRef.current.entries()){
      const p = info.pos;
      const d = dist(p, tower.pos);
      if(d <= (config.range + (tower.rangeBonus || 0)) && d < minD){ minD = d; closest = { id, pos: p, hp: info.hp } }
    }
    if(closest){
      lastShot.current = 0;
      const dmg = (config.dmg || 1) + (tower.dmgBonus || 0);
      const splash = config.splash || 0;
      spawnProjectile(tower.id, tower.pos, closest.id, dmg, splash);
    }
  });

  return (
    <group position={tower.pos}>
      <mesh>
        <cylinderGeometry args={[0.35,0.5,0.6,16]} />
        <meshStandardMaterial color={'#2b6cb0'} />
      </mesh>
      <mesh position={[0,0.55,0]}>
        <boxGeometry args={[0.42,0.25,0.42]} />
        <meshStandardMaterial color={'#234e6b'} />
      </mesh>
    </group>
  )
}

export default function App(){
  // game state
  const [enemies, setEnemies] = useState([]); // {id,type,hp}
  const enemyPositionsRef = useRef(new Map());
  const [projectiles, setProjectiles] = useState([]); // {id, from, targetId, dmg, splash}
  const [towers, setTowers] = useState([]); // {id, pos, type, level, dmgBonus, rangeBonus}
  const [money, setMoney] = useState(100);
  const [lives, setLives] = useState(10);
  const [wave, setWave] = useState(0);
  const [placingType, setPlacingType] = useState('basic');

  // spawn an enemy
  function spawnEnemy(type = 'basic', hp = 3){
    const id = Math.random().toString(36).slice(2,9);
    setEnemies(prev => [...prev, { id, type, hp }]);
  }

  // start next wave
  function nextWave(){
    setWave(w => w + 1);
    const currentWave = wave + 1;
    const count = 5 + Math.floor(currentWave * 1.5);
    for(let i = 0; i < count; i++){
      setTimeout(()=>{
        // choose enemy type by wave
        const t = (Math.random() < Math.min(0.25, currentWave * 0.02)) ? 'fast' : ((Math.random() < 0.12) ? 'cannon' : 'basic');
        const hp = t === 'cannon' ? 6 + currentWave : 3 + Math.floor(currentWave/2);
        spawnEnemy(t, hp);
      }, i * 700);
    }
  }

  // handle enemy reaching end
  function handleEnemyReachEnd(id){
    setEnemies(prev => prev.filter(e => e.id !== id));
    enemyPositionsRef.current.delete(id);
    setLives(l => l - 1);
  }

  // spawn projectile
  function spawnProjectile(fromTowerId, fromPos, targetId, dmg, splash=0){
    const id = Math.random().toString(36).slice(2,9);
    setProjectiles(prev => [...prev, { id, from: fromPos, targetId, dmg, splash }]);
  }

  // on projectile hit
  function handleProjectileHit(projId, hitInfo){
    // remove projectile first
    setProjectiles(prev => prev.filter(p => p.id !== projId));
    if(!hitInfo) return; // no target
    const { targetId, splash, hitPos } = hitInfo;
    setEnemies(prev => {
      let updated = prev.map(e => ({ ...e }));
      // create a map for quick access
      const byId = new Map(updated.map(e => [e.id, e]));

      const target = byId.get(targetId);
      if(!target) return prev; // already dead

      // apply direct damage
      target.hp -= (projectiles.find(p=>p.id===projId)?.dmg) || 1; // fallback

      // splash damage
      if(splash && hitPos){
        for(const e of updated){
          const posObj = enemyPositionsRef.current.get(e.id);
          if(!posObj) continue;
          if(dist(posObj.pos, hitPos) <= splash){ e.hp -= (projectiles.find(p=>p.id===projId)?.dmg || 1); }
        }
      }

      // collect kills and reward
      let reward = 0;
      updated = updated.filter(e => {
        if(e.hp <= 0){ reward += 10; enemyPositionsRef.current.delete(e.id); return false }
        return true;
      });
      if(reward) setMoney(m => m + reward);
      return updated;
    });
  }

  // occasionally clean projectiles that target missing enemies
  useEffect(()=>{
    setProjectiles(prev => prev.filter(p => enemyPositionsRef.current.has(p.targetId)));
  }, [enemies]);

  // place tower on click
  function onPlaceTower(x,z){
    const type = placingType;
    const cfg = TOWER_TYPES[type];
    if(!cfg) return alert('Tipus de torre desconegut.');
    if(money < cfg.cost) return alert('No tens suficients diners.');
    const px = Math.round(x);
    const pz = Math.round(z);
    const pos = [px, 0, pz];
    const newTower = { id: Math.random().toString(36).slice(2,9), pos, type, level: 1, dmgBonus: 0, rangeBonus: 0 };
    setTowers(prev => [...prev, newTower]);
    setMoney(m => m - cfg.cost);
  }

  // upgrade tower
  function upgradeTower(towerId){
    setTowers(prev => prev.map(t => {
      if(t.id !== towerId) return t;
      const cfg = TOWER_TYPES[t.type];
      const cost = Math.round(cfg.cost * Math.pow(1.6, t.level));
      if(money < cost) { alert('No tens diners per millorar.'); return t }
      setMoney(m => m - cost);
      return { ...t, level: t.level + 1, dmgBonus: (t.dmgBonus || 0) + Math.round(cfg.dmg*0.6), rangeBonus: (t.rangeBonus||0) + 0.8 };
    }));
  }

  // sell tower
  function sellTower(towerId){
    setTowers(prev => prev.filter(t => t.id !== towerId));
    // refund half cost (simple)
    // compute approximate refund by base cost
    const t = towers.find(x=>x.id===towerId);
    if(t){ setMoney(m => m + Math.round(TOWER_TYPES[t.type].cost * 0.5)); }
  }

  // reset
  function resetGame(){
    setEnemies([]); setProjectiles([]); setTowers([]); setMoney(100); setLives(10); setWave(0); enemyPositionsRef.current.clear();
  }

  // save/load (simple localStorage)
  function saveGame(){
    const save = { money, lives, wave, towers };
    localStorage.setItem('td_save_v1', JSON.stringify(save));
    alert('Partida guardada.');
  }
  function loadGame(){
    const s = localStorage.getItem('td_save_v1');
    if(!s) return alert('No hi ha partida guardada.');
    const obj = JSON.parse(s);
    setMoney(obj.money||100); setLives(obj.lives||10); setWave(obj.wave||0); setTowers(obj.towers||[]);
  }

  return (
    <div className="h-screen w-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white">
      <div className="flex h-full">
        <div className="w-3/4">
          <Canvas camera={{ position: [0, 14, 16], fov: 50 }}>
            <ambientLight intensity={0.6} />
            <directionalLight position={[5, 10, 5]} intensity={0.8} />
            <OrbitControls maxPolarAngle={Math.PI / 2.2} />

            {/* Ground */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <planeGeometry args={[40, 40, 4, 4]} />
              <meshStandardMaterial color={'#0f172a'} />
            </mesh>

            {/* Path markers */}
            {PATH.map((p, i) => (
              <mesh key={i} position={p}>
                <boxGeometry args={[1.2, 0.02, 1.2]} />
                <meshStandardMaterial color={'#a78bfa'} />
              </mesh>
            ))}

            {/* Towers */}
            {towers.map(t => (
              <TowerMesh key={t.id} tower={t} enemyPositionsRef={enemyPositionsRef} spawnProjectile={(fromId, fromPos, targetId, dmg, splash)=> spawnProjectile(fromId, fromPos, targetId, dmg, splash)} />
            ))}

            {/* Enemies */}
            {enemies.map(e => (
              <EnemyMesh key={e.id} id={e.id} type={e.type} hp={e.hp} enemyPositionsRef={enemyPositionsRef} onReachEnd={handleEnemyReachEnd} />
            ))}

            {/* Projectiles */}
            {projectiles.map(p => (
              <ProjectileMesh key={p.id} id={p.id} from={p.from} targetId={p.targetId} enemyPositionsRef={enemyPositionsRef} onHit={handleProjectileHit} splash={p.splash} />
            ))}

            {/* click plane */}
            <mesh rotation={[-Math.PI/2,0,0]} position={[0,0,0]} onClick={(ev)=>{ const { x, z } = ev.point; onPlaceTower(x,z); }}>
              <planeGeometry args={[40,40]} />
              <meshBasicMaterial transparent opacity={0} />
            </mesh>
          </Canvas>
        </div>

        <div className="w-1/4 p-4 bg-slate-800/60 backdrop-blur">
          <h2 className="text-xl font-bold mb-2">3D Tower Defense — Mejorado</h2>
          <div className="mb-2">Diners: <b>{money}</b></div>
          <div className="mb-2">Vides: <b>{lives}</b></div>
          <div className="mb-2">Onada: <b>{wave}</b></div>

          <div className="mb-3">
            <div className="font-semibold">Selecciona torre per col·locar:</div>
            <div className="flex gap-2 mt-2">
              {Object.values(TOWER_TYPES).map(t=> (
                <button key={t.key} className={`px-2 py-1 rounded ${placingType===t.key? 'bg-indigo-600' : 'bg-zinc-700'}`} onClick={()=>setPlacingType(t.key)}>
                  {t.name} ({t.cost})
                </button>
              ))}
            </div>
            <div className="text-xs mt-1 text-slate-300">Fes click a l'àrea 3D per col·locar la torre seleccionada.</div>
          </div>

          <div className="flex gap-2">
            <button className="px-3 py-1 bg-indigo-600 rounded" onClick={nextWave}>Inicia onada</button>
            <button className="px-3 py-1 bg-rose-600 rounded" onClick={resetGame}>Reinicia</button>
          </div>

          <div className="mt-4">
            <h3 className="font-semibold">Torre instal·lades</h3>
            <div className="space-y-2 mt-2 text-sm">
              {towers.length === 0 && <div className="text-slate-400">No hi ha torres encara.</div>}
              {towers.map(t=> (
                <div key={t.id} className="p-2 bg-slate-700/40 rounded flex justify-between items-center">
                  <div>
                    <div className="font-medium">{TOWER_TYPES[t.type].name} (Lvl {t.level})</div>
                    <div className="text-xs text-slate-300">Pos: {t.pos[0]}, {t.pos[2]}</div>
                  </div>
                  <div className="flex gap-2">
                    <button className="px-2 py-1 bg-emerald-600 rounded text-xs" onClick={()=>upgradeTower(t.id)}>Millorar</button>
                    <button className="px-2 py-1 bg-rose-600 rounded text-xs" onClick={()=>sellTower(t.id)}>Vendre</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 text-sm text-slate-300">
            <button className="px-2 py-1 mr-2 bg-slate-600 rounded" onClick={saveGame}>Guardar</button>
            <button className="px-2 py-1 bg-slate-600 rounded" onClick={loadGame}>Carregar</button>
          </div>

          <div className="mt-4 text-xs text-slate-400">
            <div>Idees per millorar: afegir UI de selecció de manera (onades), jefes, millores globals, diferents maps, animacions i sons.</div>
          </div>
        </div>
      </div>
    </div>
  )
}
