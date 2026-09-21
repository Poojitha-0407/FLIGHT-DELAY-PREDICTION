"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

/* Night approach from the flight deck. All procedural -- no model to download,
 * and at night a real windscreen is mostly silhouette anyway. ~5s, skippable,
 * once per session. */

const DURATION_MS = 5200;
const SEEN_KEY = "fdp.intro.seen";

interface Props {
  onDone: () => void;
}

export default function CockpitIntro({ onDone }: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState(false);
  const finished = useRef(false);

  // skip and finish are the same path, so guard it
  const finish = useRef(() => {
    if (finished.current) return;
    finished.current = true;
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      // private mode; it just plays again
    }
    setDone(true);
    window.setTimeout(onDone, 900); // match the CSS fade
  });

  useEffect(() => {
    const host = mount.current;
    if (!host) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      finish.current();
      return;
    }

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x02040a, 0.0016);

    const camera = new THREE.PerspectiveCamera(
      58, host.clientWidth / host.clientHeight, 0.1, 4000,
    );

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.setClearColor(0x02040a, 1);
    host.appendChild(renderer.domElement);

    const world = new THREE.Group();
    scene.add(world);

    // thinned near the horizon, the way haze does it
    const starCount = 1800;
    const starPos = new Float32Array(starCount * 3);
    const starCol = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 1500 + Math.random() * 900;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 0.82 + 0.05); // keep them high
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = Math.abs(r * Math.cos(phi)) * 0.7 + 60;
      starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      const warm = Math.random();
      starCol[i * 3] = 0.6 + warm * 0.4;
      starCol[i * 3 + 1] = 0.7 + warm * 0.3;
      starCol[i * 3 + 2] = 1.0;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    starGeo.setAttribute("color", new THREE.BufferAttribute(starCol, 3));
    const stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({
        size: 2.4, vertexColors: true, transparent: true,
        opacity: 0.9, sizeAttenuation: false,
      }),
    );
    world.add(stars);

    // clustered, or it reads as noise instead of towns
    const cityCount = 2600;
    const cityPos = new Float32Array(cityCount * 3);
    const cityCol = new Float32Array(cityCount * 3);
    const clusters = Array.from({ length: 22 }, () => ({
      x: (Math.random() - 0.5) * 2600,
      z: -Math.random() * 2600 - 200,
      s: 60 + Math.random() * 190,
    }));
    for (let i = 0; i < cityCount; i++) {
      const c = clusters[(Math.random() * clusters.length) | 0];
      cityPos[i * 3] = c.x + (Math.random() - 0.5) * c.s * 2;
      cityPos[i * 3 + 1] = -120 + Math.random() * 6;
      cityPos[i * 3 + 2] = c.z + (Math.random() - 0.5) * c.s * 2;
      // mostly sodium-vapour amber
      const sodium = Math.random() > 0.22;
      cityCol[i * 3] = 1.0;
      cityCol[i * 3 + 1] = sodium ? 0.66 : 0.85;
      cityCol[i * 3 + 2] = sodium ? 0.22 : 0.95;
    }
    const cityGeo = new THREE.BufferGeometry();
    cityGeo.setAttribute("position", new THREE.BufferAttribute(cityPos, 3));
    cityGeo.setAttribute("color", new THREE.BufferAttribute(cityCol, 3));
    const cities = new THREE.Points(
      cityGeo,
      new THREE.PointsMaterial({
        size: 3.1, vertexColors: true, transparent: true,
        opacity: 0.95, sizeAttenuation: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    world.add(cities);

    // airglow -- what gives the night horizon its edge
    const glowGeo = new THREE.PlaneGeometry(7000, 420);
    const glowMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uT: { value: 0 } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uT;
        void main() {
          float band = pow(1.0 - abs(vUv.y - 0.5) * 2.0, 3.0);
          float sway = 0.92 + 0.08 * sin(vUv.x * 9.0 + uT * 0.35);
          vec3 col = mix(vec3(0.02, 0.18, 0.32), vec3(0.30, 0.55, 0.85), band);
          gl_FragColor = vec4(col, band * 0.55 * sway);
        }`,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.set(0, -60, -2200);
    world.add(glow);

    // Silhouette only: aperture cut from a dark panel, centre post,
    // glareshield. At night that's about all you can see.
    const cockpit = new THREE.Group();

    const shape = new THREE.Shape();
    shape.moveTo(-9, -5.2);
    shape.lineTo(9, -5.2);
    shape.lineTo(9, 5.2);
    shape.lineTo(-9, 5.2);
    shape.lineTo(-9, -5.2);

    // canted trapezoid, wider at the top like the real thing
    const hole = new THREE.Path();
    hole.moveTo(-3.5, -1.65);
    hole.lineTo(3.5, -1.65);
    hole.lineTo(4.25, 1.5);
    hole.lineTo(-4.25, 1.5);
    hole.lineTo(-3.5, -1.65);
    shape.holes.push(hole);

    const frame = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false }),
      new THREE.MeshBasicMaterial({ color: 0x05080d }),
    );
    frame.position.z = -2.2;
    cockpit.add(frame);

    // centre post
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 3.3, 0.5),
      new THREE.MeshBasicMaterial({ color: 0x0a1018 }),
    );
    post.position.set(0, -0.08, -2.15);
    cockpit.add(post);

    // instrument light catching the inner edge
    const rim = new THREE.Mesh(
      new THREE.BoxGeometry(8.7, 0.035, 0.02),
      new THREE.MeshBasicMaterial({ color: 0xffb000, transparent: true, opacity: 0.34 }),
    );
    rim.position.set(0, -1.68, -2.18);
    cockpit.add(rim);

    // glareshield glow
    const shield = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 1.5),
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: {},
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          varying vec2 vUv;
          void main() {
            float up = pow(vUv.y, 2.4);
            gl_FragColor = vec4(1.0, 0.63, 0.06, up * 0.22);
          }`,
      }),
    );
    shield.position.set(0, -2.35, -2.1);
    cockpit.add(shield);

    scene.add(cockpit);

    const clock = new THREE.Clock();
    let raf = 0;

    const easeInOut = (t: number) =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    const tick = () => {
      const elapsed = clock.getElapsedTime();
      const t = Math.min(elapsed * 1000 / DURATION_MS, 1);
      const e = easeInOut(t);

      // roll out of a shallow left bank
      const bank = (1 - e) * 0.13 * Math.cos(elapsed * 0.55);
      world.rotation.z = bank;
      world.rotation.x = -0.02 + (1 - e) * 0.03;

      // world slides past; city lights recycle behind
      const speed = 150 + (1 - e) * 220;
      cities.position.z += speed * 0.016;
      if (cities.position.z > 1400) cities.position.z -= 2600;
      stars.rotation.y = elapsed * 0.004;

      // ease back off the glass, lift slightly
      camera.position.set(
        Math.sin(elapsed * 0.35) * 0.06 * (1 - e),
        0.1 + e * 0.5,
        3.2 + e * 5.4,
      );
      camera.lookAt(0, 0.1 - e * 0.15, -40);

      // frame recedes too, so the aperture opens outward
      cockpit.position.z = e * 2.6;
      (frame.material as THREE.MeshBasicMaterial).opacity = 1;

      glowMat.uniforms.uT.value = elapsed;

      renderer.render(scene, camera);
      if (t >= 1) {
        finish.current();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onResize = () => {
      if (!host.clientWidth) return;
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(host.clientWidth, host.clientHeight);
    };
    window.addEventListener("resize", onResize);

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" || ev.key === " ") finish.current();
    };
    window.addEventListener("keydown", onKey);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
      renderer.dispose();
      starGeo.dispose();
      cityGeo.dispose();
      glowGeo.dispose();
      glowMat.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        }
      });
      host.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div className="intro" data-done={done} ref={mount}>
      <div className="intro-copy">
        <div className="intro-title">FLIGHT DELAY</div>
        <div className="intro-sub">2,496,306 FLIGHTS &middot; 30 AIRPORTS &middot; 2025</div>
      </div>
      <button className="intro-skip" onClick={() => finish.current()}>
        SKIP &middot; ESC
      </button>
    </div>
  );
}

export function introAlreadySeen(): boolean {
  try {
    return sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}
