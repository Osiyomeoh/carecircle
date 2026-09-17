import { Suspense, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, Html, MeshDistortMaterial, Icosahedron, OrbitControls } from '@react-three/drei';
import { Link } from 'react-router-dom';
import * as THREE from 'three';
import { useBoard } from '../lib/useBoard';

const SURFACES = [
  { key: 'alexa', name: 'Alexa+', sub: 'declared', color: '#4ea1ff', status: 'live', angle: 0 },
  { key: 'ring', name: 'Ring', sub: 'physical', color: '#25d3c2', status: 'seam', angle: Math.PI / 2 },
  { key: 'bee', name: 'Bee', sub: 'ambient', color: '#ffb020', status: 'seam', angle: Math.PI },
  { key: 'tv', name: 'Fire TV', sub: 'shared display', color: '#b46bff', status: 'seam', angle: (3 * Math.PI) / 2 },
] as const;

const R = 4.2;

function Core({ intensity }: { intensity: number }) {
  const shell = useRef<THREE.Mesh>(null!);
  useFrame((_, dt) => { if (shell.current) shell.current.rotation.y += dt * 0.15; });
  return (
    <group>
      <Float speed={2} rotationIntensity={0.4} floatIntensity={0.6}>
        <Icosahedron args={[1.15, 4]}>
          <MeshDistortMaterial
            color="#7cf0c8" emissive="#7cf0c8" emissiveIntensity={intensity}
            roughness={0.2} metalness={0.4} distort={0.28} speed={1.6} flatShading
          />
        </Icosahedron>
      </Float>
      <Icosahedron ref={shell} args={[1.5, 1]}>
        <meshBasicMaterial color="#7cf0c8" wireframe transparent opacity={0.18} />
      </Icosahedron>
      <pointLight color="#7cf0c8" intensity={2.2} distance={22} />
    </group>
  );
}

function DeviceNode({ color, angle, name, sub, status }: Omit<(typeof SURFACES)[number], 'key'>) {
  const pos = useMemo(() => new THREE.Vector3(Math.cos(angle) * R, 0, Math.sin(angle) * R), [angle]);
  return (
    <group position={pos}>
      <Float speed={3} floatIntensity={0.8}>
        <mesh>
          <sphereGeometry args={[0.36, 24, 24]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.9} roughness={0.3} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -0.28, 0]}>
          <torusGeometry args={[0.55, 0.02, 12, 48]} />
          <meshBasicMaterial color={color} transparent opacity={0.5} />
        </mesh>
      </Float>
      <Html center distanceFactor={9} position={[0, 1.0, 0]}>
        <div className="whitespace-nowrap px-2.5 py-1 rounded-lg text-[13px] bg-bg/70 border border-line backdrop-blur-sm">
          <span className="font-semibold text-ink">{name}</span>
          <span className="text-muted"> · {sub}</span>
          <span className={`ml-1.5 uppercase text-[10px] tracking-wider ${status === 'live' ? 'text-confirmed' : 'text-muted'}`}>
            {status}
          </span>
        </div>
      </Html>
    </group>
  );
}

function Stream({ angle, color }: { angle: number; color: string }) {
  const COUNT = 7;
  const group = useRef<THREE.Group>(null!);
  const from = useMemo(() => new THREE.Vector3(Math.cos(angle) * R, 0, Math.sin(angle) * R), [angle]);
  const mid = useMemo(() => from.clone().multiplyScalar(0.5).setY(2.2), [from]);
  const to = useMemo(() => new THREE.Vector3(0, 0, 0), []);
  const offs = useMemo(() => Array.from({ length: COUNT }, (_, i) => i / COUNT), []);
  useFrame((state) => {
    if (!group.current) return;
    const t0 = state.clock.elapsedTime * 0.22;
    group.current.children.forEach((child, i) => {
      const t = (t0 + offs[i]) % 1;
      const u = 1 - t;
      child.position.set(
        u * u * from.x + 2 * u * t * mid.x + t * t * to.x,
        u * u * from.y + 2 * u * t * mid.y + t * t * to.y,
        u * u * from.z + 2 * u * t * mid.z + t * t * to.z,
      );
      (child as THREE.Mesh).scale.setScalar(0.6 + Math.sin(t * Math.PI) * 0.6);
    });
  });
  return (
    <group ref={group}>
      {offs.map((_, i) => (
        <mesh key={i}>
          <sphereGeometry args={[0.08, 8, 8]} />
          <meshBasicMaterial color={color} />
        </mesh>
      ))}
    </group>
  );
}

function Scene({ intensity }: { intensity: number }) {
  const rig = useRef<THREE.Group>(null!);
  useFrame((state) => {
    // gentle parallax toward the pointer
    if (rig.current) {
      rig.current.rotation.y = THREE.MathUtils.lerp(rig.current.rotation.y, state.pointer.x * 0.3, 0.05);
      rig.current.rotation.x = THREE.MathUtils.lerp(rig.current.rotation.x, -state.pointer.y * 0.15, 0.05);
    }
  });
  return (
    <>
      <ambientLight intensity={0.7} color="#4a5a7a" />
      <pointLight position={[6, 8, 6]} intensity={1.1} color="#9fd8ff" />
      <group ref={rig}>
        <Core intensity={intensity} />
        {SURFACES.map(({ key, ...s }) => <DeviceNode key={key} {...s} />)}
        {SURFACES.map((s) => <Stream key={s.key} angle={s.angle} color={s.color} />)}
      </group>
      <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={0.6}
        minPolarAngle={Math.PI / 2.6} maxPolarAngle={Math.PI / 2.6} enableRotate={false} />
    </>
  );
}

export default function Hero() {
  const { state, online } = useBoard();
  const gaps = state?.gaps?.length ?? 0;
  const owned = (state?.obligations ?? []).filter((o) => o.status === 'ASSIGNED').length;
  const intensity = 0.5 + Math.min(gaps, 4) * 0.2;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-bg">
      {/* 3D layer */}
      <div className="absolute inset-0 md:left-[38%]">
        <Canvas camera={{ position: [0, 3.5, 9.5], fov: 50 }} dpr={[1, 2]}>
          <fog attach="fog" args={['#07090f', 8, 22]} />
          <Suspense fallback={null}><Scene intensity={intensity} /></Suspense>
        </Canvas>
      </div>

      {/* readability scrim */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-bg via-bg/80 to-transparent md:via-bg/60" />

      {/* overlay copy */}
      <div className="relative z-10 flex h-full flex-col justify-between p-6 md:p-14">
        <div className="flex items-start justify-between gap-6">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 rounded-full bg-core shadow-[0_0_18px_#7cf0c8]" />
            <b className="text-lg tracking-wide">CareCircle</b>
          </div>
          <div className="glass flex items-center gap-2.5 rounded-full px-3.5 py-2 text-[13px] text-muted">
            <span className={`h-2 w-2 rounded-full ${online ? 'bg-confirmed' : 'bg-sevHigh'} animate-beat`} />
            {online ? <span><b className="text-ink">{gaps}</b> open · <b className="text-ink">{owned}</b> owned</span>
              : <span>care board offline</span>}
          </div>
        </div>

        <div className="max-w-2xl animate-rise">
          <div className="mb-3.5 text-[13px] uppercase tracking-[0.16em] text-muted">The responsibility layer for family care</div>
          <h1 className="text-4xl font-semibold leading-[1.04] tracking-tight md:text-6xl">
            Four surfaces. Four kinds of evidence.{' '}
            <span className="bg-gradient-to-r from-core to-alexa bg-clip-text text-transparent">One system that never guesses.</span>
          </h1>
          <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-[#c3cad9] md:text-lg">
            Margaret's Echo, her Ring doorbell, a Bee wearable, the living-room Fire TV - each sees something
            different. CareCircle turns that evidence into shared obligations, finds the gaps nobody owns, and
            lets the family resolve them by voice. It never turns a missing record into an accusation.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link to="/console" className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-core to-[#57c6ff] px-5 py-3 text-[15px] font-semibold text-[#04120d] shadow-glow transition hover:-translate-y-0.5">
              Open the live demo →
            </Link>
            <Link to="/tv" className="glass inline-flex items-center gap-2 rounded-xl px-5 py-3 text-[15px] font-medium text-ink transition hover:-translate-y-0.5">
              See the TV board
            </Link>
          </div>
        </div>

        <div className="flex flex-wrap gap-2.5">
          {SURFACES.map((s) => (
            <div key={s.key} className="glass flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px]">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
              <span className="text-muted">{s.name}</span>
              <span className="font-semibold text-ink">{s.sub}</span>
              <span className={`ml-1 rounded-md border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${s.status === 'live' ? 'text-core' : 'text-muted'}`}>{s.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
