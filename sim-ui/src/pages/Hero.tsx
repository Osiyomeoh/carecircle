import { Suspense, useMemo, useRef, type ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, Html, MeshDistortMaterial, Icosahedron, OrbitControls } from '@react-three/drei';
import { Link } from 'react-router-dom';
import * as THREE from 'three';
import { useBoard } from '../lib/useBoard';

/**
 * The one page that has to make the whole argument.
 *
 * Everything CareCircle is follows from a single observation, and the page is
 * ordered so a reader meets it before anything else: **care is already shared,
 * and nothing shares it.** More than half of family caregivers are coordinating
 * with someone else over the same person, with no system holding who owes what.
 *
 * So the sections below are not a feature tour. They are one argument:
 *   the problem is shared responsibility -> the hard part is not guessing ->
 *   here is the mechanism -> here are four surfaces of the same idea ->
 *   here is what it contributes back to the protocol.
 *
 * The four surfaces are deliberately framed as four *kinds of evidence* feeding
 * one responsibility layer, never as four separate integrations. If this page
 * ever reads as a list of demos, it has stopped doing its job.
 */

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
      {/* drei portals these labels into their own stacking context, which by
          default floats above the copy overlay and lets a device name land on
          top of the headline. Bounding the range below the overlay's z-10 keeps
          them behind the text where they belong. */}
      <Html center distanceFactor={9} position={[0, 1.0, 0]} zIndexRange={[5, 0]}>
        <div className="whitespace-nowrap px-2.5 py-1 rounded-lg text-[0.8125rem] bg-bg/70 border border-line backdrop-blur-sm">
          <span className="font-semibold text-ink">{name}</span>
          <span className="text-muted"> · {sub}</span>
          <span className={`ml-1.5 uppercase text-[0.625rem] tracking-wider ${status === 'live' ? 'text-confirmed' : 'text-muted'}`}>
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

// --- page furniture -------------------------------------------------------

function Section({ eyebrow, title, lead, children }: {
  eyebrow: string; title: ReactNode; lead?: ReactNode; children?: ReactNode;
}) {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-20 md:px-10 md:py-28 tv:max-w-[80rem]">
      <div className="text-[0.75rem] uppercase tracking-[0.22em] text-muted">{eyebrow}</div>
      <h2 className="mt-4 max-w-3xl text-3xl font-semibold leading-[1.12] tracking-tight md:text-5xl">
        {title}
      </h2>
      {lead && <p className="mt-6 max-w-2xl text-[0.9375rem] leading-relaxed text-[#c3cad9] md:text-lg">{lead}</p>}
      {children}
    </section>
  );
}

/**
 * A cited number, and the specific thing CareCircle does about it.
 *
 * The pairing is the point: a statistic with no mechanism beside it is
 * decoration, and a mechanism with no evidence behind it is a claim.
 */
function Evidence({ figure, of, source, href, mechanism }: {
  figure: string; of: string; source: string; href: string; mechanism: string;
}) {
  return (
    <div className="glass flex flex-col rounded-2xl p-6">
      <div className="text-4xl font-semibold tracking-tight text-ink md:text-5xl">{figure}</div>
      <div className="mt-3 text-[0.9375rem] leading-relaxed text-[#c3cad9]">{of}</div>
      <a
        href={href} target="_blank" rel="noreferrer"
        className="mt-3 text-[0.75rem] text-muted underline decoration-line underline-offset-4 transition hover:text-ink"
      >
        {source}
      </a>
      <div className="mt-5 border-t border-line pt-5 text-[0.875rem] leading-relaxed text-ink">
        <span className="text-[0.6875rem] uppercase tracking-[0.14em] text-core">What CareCircle does</span>
        <div className="mt-2 text-[#c3cad9]">{mechanism}</div>
      </div>
    </div>
  );
}

function Step({ n, name, body }: { n: string; name: string; body: string }) {
  return (
    <div className="glass rounded-2xl p-6">
      <div className="text-[0.75rem] tracking-[0.2em] text-muted">{n}</div>
      <div className="mt-3 text-lg font-semibold text-ink">{name}</div>
      <p className="mt-2 text-[0.875rem] leading-relaxed text-[#c3cad9]">{body}</p>
    </div>
  );
}

export default function Hero() {
  const { state, online } = useBoard();
  const gaps = state?.gaps?.length ?? 0;
  const owned = (state?.obligations ?? []).filter((o) => o.status === 'ASSIGNED').length;
  const intensity = 0.5 + Math.min(gaps, 4) * 0.2;

  return (
    <div className="min-h-screen w-full bg-bg">
      {/* ---------- 1. The claim ---------- */}
      {/* A minimum, not a cap: on a short phone the copy is taller than the
          viewport, and h-screen silently cut the surface chips off the bottom.
          svh rather than vh so mobile browser chrome does not make it jump. */}
      <div className="relative min-h-[100svh] w-full overflow-hidden">
        <div className="absolute inset-0 md:left-[42%]">
          <Canvas camera={{ position: [0, 3.5, 9.5], fov: 50 }} dpr={[1, 2]}>
            <fog attach="fog" args={['#07090f', 8, 22]} />
            <Suspense fallback={null}><Scene intensity={intensity} /></Suspense>
          </Canvas>
        </div>

        {/* The copy has to win. A device orbiting to the inner edge of the canvas
            would otherwise smudge the column the headline sits in, so the scrim
            stays opaque across the text and only clears over open space. */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-bg via-bg/85 to-transparent md:via-bg/70" />
        <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-[46%] bg-gradient-to-r from-bg via-bg/95 to-transparent md:block" />

        <div className="relative z-10 flex min-h-[100svh] flex-col justify-between gap-10 p-6 md:p-14">
          <div className="flex items-start justify-between gap-6">
            <div className="flex items-center gap-3">
              <span className="h-3 w-3 rounded-full bg-core shadow-[0_0_18px_#7cf0c8]" />
              <b className="text-lg tracking-wide">CareCircle</b>
            </div>
            <div className="glass flex items-center gap-2.5 rounded-full px-3.5 py-2 text-[0.8125rem] text-muted">
              <span className={`h-2 w-2 rounded-full ${online ? 'bg-confirmed' : 'bg-sevHigh'} animate-beat`} />
              {online ? <span><b className="text-ink">{gaps}</b> open · <b className="text-ink">{owned}</b> owned</span>
                : <span>care board offline</span>}
            </div>
          </div>

          <div className="max-w-2xl animate-rise">
            <div className="mb-3.5 text-[0.8125rem] uppercase tracking-[0.16em] text-muted">The responsibility layer for family care</div>
            <h1 className="text-4xl font-semibold leading-[1.04] tracking-tight md:text-6xl">
              Care is already shared.{' '}
              <span className="bg-gradient-to-r from-core to-alexa bg-clip-text text-transparent">Nothing shares it.</span>
            </h1>
            <p className="mt-5 max-w-xl text-[0.9375rem] leading-relaxed text-[#c3cad9] md:text-lg">
              Two siblings and a paid aide look after Margaret. Each of them knows part of what
              happened today, and no system holds the whole. CareCircle turns what everyone says
              and everything the house notices into shared obligations, finds the ones nobody owns,
              and never turns a missing record into an accusation.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to="/console" className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-core to-[#57c6ff] px-5 py-3 text-[0.9375rem] font-semibold text-[#04120d] shadow-glow transition hover:-translate-y-0.5">
                Open the live demo →
              </Link>
              <a href="#problem" className="glass inline-flex items-center gap-2 rounded-xl px-5 py-3 text-[0.9375rem] font-medium text-ink transition hover:-translate-y-0.5">
                See how it works
              </a>
            </div>
          </div>

          <div className="flex flex-wrap gap-2.5">
            {SURFACES.map((s) => (
              <div key={s.key} className="glass flex items-center gap-2.5 rounded-xl px-3 py-2 text-[0.8125rem]">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                <span className="text-muted">{s.name}</span>
                <span className="font-semibold text-ink">{s.sub}</span>
                <span className={`ml-1 rounded-md border border-line px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wider ${s.status === 'live' ? 'text-core' : 'text-muted'}`}>{s.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ---------- 2. The problem, with its evidence ---------- */}
      <div id="problem" className="border-t border-line">
        <Section
          eyebrow="The problem"
          title={<>Nobody is in charge, so the work that falls through is the work nobody realised was anyone&rsquo;s job.</>}
          lead={<>
            Family care is not one person with a checklist. It is several people with partial
            information and no shared record - and the failure mode is not that someone refuses a
            task. It is that everyone assumes someone else has it.
          </>}
        >
          <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            <Evidence
              figure="53M"
              of="adults in the US care for an adult or child with special needs - more than one in five."
              source="AARP & National Alliance for Caregiving, Caregiving in the U.S. 2020"
              href="https://www.caregiving.org/research/caregiving-in-the-us/caregiving-in-the-us-2020/"
              mechanism="CareCircle models the household, not the patient - several people with different authority over one shared record."
            />
            <Evidence
              figure="53%"
              of="of caregivers say someone else also provides unpaid help to the same person."
              source="AARP & NAC, Caregiving in the U.S. 2020"
              href="https://www.caregiving.org/research/caregiving-in-the-us/caregiving-in-the-us-2020/"
              mechanism="Ownership is the primitive. Every obligation has exactly one owner, or is visibly unowned - which is the thing a Care Gap actually measures."
            />
            <Evidence
              figure="58%"
              of="of caregivers perform medical or nursing tasks, including managing medications."
              source="AARP & NAC, Caregiving in the U.S. 2020"
              href="https://www.caregiving.org/research/caregiving-in-the-us/caregiving-in-the-us-2020/"
              mechanism="The Care Gap engine checks expected doses against what was actually recorded, and ranks what is unowned by expected harm."
            />
            <Evidence
              figure="~50%"
              of="average adherence to long-term therapy for chronic illness in developed countries."
              source="WHO, Adherence to Long-Term Therapies: Evidence for Action (2003)"
              href="https://www.paho.org/en/documents/who-adherence-long-term-therapies-evidence-action-2003"
              mechanism="A dose with no record is surfaced as a question for the family, never as a claim that it was missed."
            />
          </div>
        </Section>
      </div>

      {/* ---------- 3. The proof ---------- */}
      <div className="border-t border-line bg-gradient-to-b from-transparent to-[#0a0e18]">
        <Section
          eyebrow="Why it can be trusted"
          title={<>Known is not Assumed - and we measured what that is worth.</>}
          lead={<>
            Ask a language model whether Mom took her heart pill when the log simply has no entry,
            and it will often tell you she didn&rsquo;t. That is not a wording problem. In a house
            where someone is ill, it is an accusation aimed at whoever was supposed to be there.
          </>}
        >
          <div className="mt-12 grid items-stretch gap-5 lg:grid-cols-3">
            <div className="glass rounded-2xl p-7">
              <div className="text-[0.75rem] uppercase tracking-[0.18em] text-muted">Raw Claude Sonnet 4.5</div>
              <div className="mt-4 text-6xl font-semibold tracking-tight text-sevHigh">50%</div>
              <p className="mt-4 text-[0.875rem] leading-relaxed text-[#c3cad9]">
                In <b className="text-ink">6 of 12</b> scenarios the same model CareCircle plans with
                asserted the accusation outright - &ldquo;she missed it&rdquo;, &ldquo;she
                hasn&rsquo;t taken it&rdquo; - from a record that only ever said nothing.
              </p>
            </div>

            <div className="glass rounded-2xl p-7">
              <div className="text-[0.75rem] uppercase tracking-[0.18em] text-muted">CareCircle</div>
              <div className="mt-4 text-6xl font-semibold tracking-tight text-confirmed">0%</div>
              <p className="mt-4 text-[0.875rem] leading-relaxed text-[#c3cad9]">
                Same scenarios. The deterministic engine can only report what it has:
                <b className="text-ink"> &ldquo;there&rsquo;s no record of it.&rdquo;</b> The model
                never gets to narrate the gap - it only speaks the line the engine produced.
              </p>
            </div>

            <div className="glass flex flex-col rounded-2xl p-7">
              <div className="text-[0.75rem] uppercase tracking-[0.18em] text-muted">Check it yourself</div>
              <p className="mt-4 text-[0.875rem] leading-relaxed text-[#c3cad9]">
                Every answer in the benchmark is printed and auditable. It is a script in the repo,
                not a screenshot.
              </p>
              <code className="mt-auto block rounded-xl border border-line bg-black/40 px-4 py-3 font-mono text-[0.8125rem] text-core">
                npm run trust-benchmark
              </code>
            </div>
          </div>

          <p className="mt-8 max-w-3xl text-[0.875rem] leading-relaxed text-muted">
            Inference proposes, humans dispose. Work the system infers - a ride to a cardiology
            appointment, say - enters as <b className="text-ink">PROPOSED</b> and is excluded from
            Care Gaps entirely until a person confirms it. CareCircle is allowed to notice. It is
            not allowed to decide on the family&rsquo;s behalf.
          </p>
        </Section>
      </div>

      {/* ---------- 4. The mechanism ---------- */}
      <div className="border-t border-line">
        <Section
          eyebrow="How it works"
          title={<>Events become obligations. Obligations need an owner.</>}
          lead={<>
            Three nouns, in one direction. Everything in the system - every tool, every surface -
            is somewhere on this line.
          </>}
        >
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            <Step
              n="01 · EVENTS"
              name="Something is observed"
              body="Someone says they gave Mom her pill. A doorbell sees a pharmacy delivery. A wearable notices she was up all night. Each carries how we came to know it."
            />
            <Step
              n="02 · OBLIGATIONS"
              name="Something is owed"
              body="An appointment implies a ride. A prescription implies a pickup. A daily dose implies a record. Inferred ones stay proposals until a human confirms them."
            />
            <Step
              n="03 · OWNERSHIP"
              name="Someone owes it"
              body="An obligation with no owner is a Care Gap, ranked by expected harm - cost x likelihood it is dropped x our confidence. Claimable by voice, or by tapping a card."
            />
          </div>
        </Section>
      </div>

      {/* ---------- 5. Four surfaces, one idea ---------- */}
      <div className="border-t border-line bg-gradient-to-b from-transparent to-[#0a0e18]">
        <Section
          eyebrow="Four surfaces, one responsibility layer"
          title={<>Not four integrations. Four kinds of evidence about one person.</>}
          lead={<>
            The devices around Margaret each see something the others cannot, and none of them is
            the product. MCP is the seam that lets all of it land in one record - which is why a
            Ring signal and a spoken sentence are handled by the same pipeline, with the same
            provenance rules.
          </>}
        >
          <div className="mt-12 grid gap-5 md:grid-cols-2">
            <div className="glass rounded-2xl p-7">
              <div className="flex items-center gap-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-alexa" />
                <span className="font-semibold text-ink">Alexa+</span>
                <span className="text-muted">· declared evidence</span>
                <span className="ml-auto rounded-md border border-line px-2 py-0.5 text-[0.625rem] uppercase tracking-wider text-core">live</span>
              </div>
              <p className="mt-4 text-[0.875rem] leading-relaxed text-[#c3cad9]">
                What a person tells you. The MCP server itself: 18 tools, per-member identity bound
                to the session rather than to the conversation, purchase-in-place, and an
                interactive Care Board shipped as an MCP App.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link to="/console" className="btn-primary">Open the console</Link>
                <Link to="/board" className="btn-ghost">See the care board</Link>
              </div>
            </div>

            <div className="glass rounded-2xl p-7">
              <div className="flex items-center gap-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-tv" />
                <span className="font-semibold text-ink">Fire TV</span>
                <span className="text-muted">· the shared display</span>
                <span className="ml-auto rounded-md border border-line px-2 py-0.5 text-[0.625rem] uppercase tracking-wider text-core">live</span>
              </div>
              <p className="mt-4 text-[0.875rem] leading-relaxed text-[#c3cad9]">
                The most valuable moment is not a conversation - it is someone walking past the
                living room and noticing Thursday still has no driver. Real React Native, the same
                screen on a TV and on the web.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link to="/tv" className="btn-primary">Watch the ambient screen</Link>
                <a href="/tv-native/" className="btn-ghost">The native build</a>
              </div>
            </div>

            <div className="glass rounded-2xl p-7">
              <div className="flex items-center gap-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-ring" />
                <span className="font-semibold text-ink">Ring</span>
                <span className="text-muted">· physical evidence</span>
                <span className="ml-auto rounded-md border border-line px-2 py-0.5 text-[0.625rem] uppercase tracking-wider text-muted">seam</span>
              </div>
              <p className="mt-4 text-[0.875rem] leading-relaxed text-[#c3cad9]">
                A delivery arrived; nobody said so. The adapter is real code against the shape of
                Ring&rsquo;s webhook, and it does what every signal does here - proposes an
                <b className="text-ink"> INFERRED</b> obligation a human still has to confirm. We
                are honest that it is a seam, not a live partnership.
              </p>
            </div>

            <div className="glass rounded-2xl p-7">
              <div className="flex items-center gap-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-bee" />
                <span className="font-semibold text-ink">Bee</span>
                <span className="text-muted">· ambient evidence</span>
                <span className="ml-auto rounded-md border border-line px-2 py-0.5 text-[0.625rem] uppercase tracking-wider text-muted">seam</span>
              </div>
              <p className="mt-4 text-[0.875rem] leading-relaxed text-[#c3cad9]">
                The weakest evidence in the house, and deliberately the most gated. Always-on
                listening near a vulnerable person earns the lowest confidence in the model, and
                nothing it notices can ever become fact without a person saying so.
              </p>
            </div>
          </div>
        </Section>
      </div>

      {/* ---------- 6. What it gives back ---------- */}
      <div className="border-t border-line">
        <Section
          eyebrow="The protocol"
          title={<>Built on MCP, and built back into it.</>}
          lead={<>
            A server this shape runs into the edges of the protocol, and the useful thing to do
            with an edge is write it down.
          </>}
        >
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            <div className="glass rounded-2xl p-6">
              <div className="text-lg font-semibold text-ink">The Care Board, as an MCP App</div>
              <p className="mt-3 text-[0.875rem] leading-relaxed text-[#c3cad9]">
                A ranked list with state does not survive being spoken. So the gaps also ship as an
                interactive view (SEP-1865): provenance on every row, the ranking&rsquo;s arithmetic
                openable, and a Claim button that calls the same tool voice would - down the same
                authorisation path.
              </p>
            </div>
            <div className="glass rounded-2xl p-6">
              <div className="text-lg font-semibold text-ink">Confirmation that survives a voice turn</div>
              <p className="mt-3 text-[0.875rem] leading-relaxed text-[#c3cad9]">
                MCP elicitation expects an answer inside the same call that raised it; an Alexa turn
                is over in seconds. CareCircle models confirmation as a separate tool call instead,
                so &ldquo;will Mom need a ride?&rdquo; then &ldquo;yes&rdquo; survives any gap
                between turns with nothing parked.
              </p>
            </div>
            <div className="glass rounded-2xl p-6">
              <div className="text-lg font-semibold text-ink">Everything that got in the way</div>
              <p className="mt-3 text-[0.875rem] leading-relaxed text-[#c3cad9]">
                Fifteen logged pieces of friction, written in the moment - the ones we worked
                around, and the ones we could not. Where the platform has since answered us, we say
                so rather than keep the complaint.
              </p>
            </div>
          </div>
        </Section>
      </div>

      {/* ---------- 7. Try it ---------- */}
      <div className="border-t border-line bg-[#0a0e18]">
        <Section
          eyebrow="See it"
          title={<>It is running right now.</>}
          lead={<>
            Not a mockup: a live MCP server, 101 tests including property-based proofs of the risk
            model, and 93.3% measured tool-selection accuracy. The full story runs end to end in
            about a minute with no AWS account and no keys.
          </>}
        >
          <pre className="mt-10 max-w-xl overflow-x-auto rounded-xl border border-line bg-black/40 px-5 py-4 font-mono text-[0.8125rem] leading-relaxed text-core">
git clone https://github.com/Osiyomeoh/carecircle{'\n'}npm ci &amp;&amp; npm run story
          </pre>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/console" className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-core to-[#57c6ff] px-5 py-3 text-[0.9375rem] font-semibold text-[#04120d] shadow-glow transition hover:-translate-y-0.5">
              Open the live demo →
            </Link>
            <Link to="/tv" className="glass inline-flex items-center gap-2 rounded-xl px-5 py-3 text-[0.9375rem] font-medium text-ink transition hover:-translate-y-0.5">
              The ambient screen
            </Link>
            <a href="https://github.com/Osiyomeoh/carecircle" target="_blank" rel="noreferrer"
              className="glass inline-flex items-center gap-2 rounded-xl px-5 py-3 text-[0.9375rem] font-medium text-ink transition hover:-translate-y-0.5">
              Read the source
            </a>
          </div>

          <div className="mt-16 border-t border-line pt-8 text-[0.8125rem] text-muted">
            CareCircle · an open-source MCP server for shared household care ·
            {' '}EVENTS &rarr; OBLIGATIONS &rarr; OWNERSHIP
          </div>
        </Section>
      </div>
    </div>
  );
}
