"use client";

/**
 * Movimiento compartido (motion.dev, `motion/react`): entradas escalonadas, cambio de paso,
 * números que cuentan, destellos (estrellitas) y confeti.
 *
 * Con «reducir movimiento» del sistema (`useReducedMotion`) no se apaga nada: lo que se desliza o
 * crece pasa a ser un simple fundido, y los destellos parpadean en su lugar sin salir disparados.
 */

import { useEffect, type ReactNode, type Ref } from "react";
import { animate, AnimatePresence, motion, useIsPresent, useMotionValue, useReducedMotion, useTransform, type Variants } from "motion/react";

export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/* ---------- Listas con entrada escalonada ---------- */

/** Contenedor: escalona a sus hijos con `itemVariants`. */
export const listVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
};

/** Hijo de una lista escalonada: sube y aparece (o solo aparece, con movimiento reducido). */
export function itemVariants(reduce: boolean | null): Variants {
  return {
    hidden: reduce ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.97 },
    show: { opacity: 1, y: 0, scale: 1, transition: { duration: reduce ? 0.25 : 0.34, ease: EASE_OUT } },
  };
}

/** Atajo: `{...staggerList()}` en el contenedor y `{...staggerItem(reduce)}` en cada hijo. */
export const staggerList = () => ({ variants: listVariants, initial: "hidden", animate: "show" }) as const;
export const staggerItem = (reduce: boolean | null) => ({ variants: itemVariants(reduce) });

/* ---------- Cambio de paso (deslizar según la dirección) ---------- */

type StepCustom = { d: number; reduce: boolean };
const stepVariants: Variants = {
  enter: ({ d, reduce }: StepCustom) => (reduce ? { opacity: 0 } : { opacity: 0, x: 56 * d }),
  center: ({ reduce }: StepCustom) => ({ opacity: 1, x: 0, transition: { duration: reduce ? 0.2 : 0.3, ease: EASE_OUT } }),
  exit: ({ d, reduce }: StepCustom) => (reduce ? { opacity: 0, transition: { duration: 0.12 } } : { opacity: 0, x: -40 * d, transition: { duration: 0.14, ease: "easeIn" } }),
};

/**
 * Marco de un paso: al cambiar `id`, el paso anterior sale hacia un lado y el nuevo entra del otro
 * (de la derecha al avanzar, de la izquierda al regresar). Sin movimiento: fundido.
 */
export function StepFrame({ id, dir, children }: { id: string; dir: "next" | "prev"; children: ReactNode }) {
  const reduce = !!useReducedMotion();
  const custom: StepCustom = { d: dir === "prev" ? -1 : 1, reduce };
  // popLayout: el paso nuevo aparece de inmediato y el anterior se desvanece encima (sin esperar)
  return (
    <AnimatePresence mode="popLayout" custom={custom}>
      <StepPane key={id} custom={custom}>
        {children}
      </StepPane>
    </AnimatePresence>
  );
}

function StepPane({ custom, children, ref }: { custom: StepCustom; children: ReactNode; ref?: Ref<HTMLDivElement> }) {
  // El paso que sale queda fuera de lectores de pantalla, clics y foco (no hay dos «✓ Lo logré»)
  const present = useIsPresent();
  return (
    <motion.div
      ref={ref}
      aria-hidden={present ? undefined : true}
      custom={custom}
      variants={stepVariants}
      initial="enter"
      animate="center"
      exit="exit"
      inert={!present}
      style={present ? undefined : { pointerEvents: "none" }}
    >
      {children}
    </motion.div>
  );
}

/* ---------- Números que cuentan ---------- */

/** Número que cuenta desde el valor anterior (desde 0 al aparecer). */
export function CountUp({ value, className, suffix = "" }: { value: number; className?: string; suffix?: string }) {
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => `${Math.round(v)}${suffix}`);
  useEffect(() => {
    const c = animate(mv, value, { duration: 0.7, ease: EASE_OUT });
    return () => c.stop();
  }, [mv, value]);
  return <motion.span className={className}>{text}</motion.span>;
}

/* ---------- Destellos (estrellitas) ---------- */

const STAR = "M12 0C13 7.5 16.5 11 24 12C16.5 13 13 16.5 12 24C11 16.5 7.5 13 0 12C7.5 11 11 7.5 12 0Z";
const SPARK_COLORS = ["#fbbf24", "#f59e0b", "#3ba3a8", "#2f5da8", "#34d399", "#fde68a"];

/**
 * Estrellitas que salen disparadas del centro del contenedor (que debe tener `position: relative`).
 * Con movimiento reducido parpadean en su lugar. `loop`: se repite mientras esté montado.
 */
export function Sparkles({
  count = 8,
  radius = 44,
  colors = SPARK_COLORS,
  delay = 0,
  loop = false,
  size = 12,
  className = "",
}: {
  count?: number;
  radius?: number;
  colors?: string[];
  delay?: number;
  loop?: boolean;
  size?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <span aria-hidden="true" className={`pointer-events-none absolute inset-0 z-10 overflow-visible ${className}`} data-sparkles="">
      {Array.from({ length: count }, (_, i) => {
        // Reparto fijo (sin azar: el render debe ser puro)
        const angle = (i / count) * Math.PI * 2 + (i % 2 ? 0.35 : -0.15);
        const dist = radius * (i % 3 === 0 ? 1.1 : i % 3 === 1 ? 0.8 : 0.95);
        const x = Math.round(Math.cos(angle) * dist);
        const y = Math.round(Math.sin(angle) * dist);
        const s = Math.round(size * (i % 3 === 0 ? 1.25 : i % 3 === 1 ? 0.8 : 1));
        const repeat = loop ? { repeat: Infinity, repeatDelay: 0.9 + (i % 3) * 0.15 } : {};
        return (
          <motion.svg
            key={i}
            viewBox="0 0 24 24"
            width={s}
            height={s}
            className="absolute left-1/2 top-1/2"
            style={{ marginLeft: -s / 2, marginTop: -s / 2, color: colors[i % colors.length] }}
            initial={reduce ? { opacity: 0, x, y } : { opacity: 0, x: 0, y: 0, scale: 0.2, rotate: 0 }}
            animate={reduce ? { opacity: [0, 1, 0.3, 1, 0] } : { opacity: [0, 1, 1, 0], x, y, scale: [0.2, 1.3, 1, 0.4], rotate: 120 }}
            transition={{ duration: reduce ? 1.1 : 0.8, delay: delay + i * 0.025, ease: "easeOut", ...repeat }}
          >
            <path d={STAR} fill="currentColor" />
          </motion.svg>
        );
      })}
    </span>
  );
}

/* ---------- Confeti de festejo ---------- */

const CONFETTI_COLORS = ["#2f5da8", "#3ba3a8", "#f59e0b", "#10b981", "#f43f5e", "#a78bfa", "#fbbf24"];

/**
 * Confeti que estalla desde arriba al centro y cae (capa fija, no bloquea clics). Con movimiento
 * reducido solo se ven destellos que parpadean.
 */
export function Confetti({ count = 36 }: { count?: number }) {
  const reduce = useReducedMotion();
  if (reduce) {
    return (
      <div className="pointer-events-none fixed inset-x-0 top-24 z-[60] mx-auto h-40 w-72" aria-hidden="true">
        <Sparkles count={12} radius={110} size={16} />
      </div>
    );
  }
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[22%] z-[60] flex justify-center" aria-hidden="true" data-confetti="">
      <div className="relative h-0 w-0">
        {Array.from({ length: count }, (_, i) => {
          const t = i / count;
          const angle = -Math.PI / 2 + (t - 0.5) * Math.PI * 1.6;
          const power = 140 + ((i * 37) % 120);
          const x = Math.round(Math.cos(angle) * power);
          const up = Math.round(Math.sin(angle) * power);
          const w = i % 3 === 0 ? 10 : 7;
          const h = i % 2 ? 14 : 8;
          return (
            <motion.span
              key={i}
              className="absolute block rounded-[2px]"
              style={{ width: w, height: h, marginLeft: -w / 2, background: CONFETTI_COLORS[i % CONFETTI_COLORS.length] }}
              initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.6 }}
              animate={{ x: [0, x, x * 1.15], y: [0, up, up + 320], rotate: (i % 2 ? 1 : -1) * (240 + (i % 5) * 60), opacity: [1, 1, 0], scale: 1 }}
              transition={{ duration: 1.5 + (i % 4) * 0.12, ease: [0.15, 0.6, 0.4, 1], times: [0, 0.35, 1], delay: (i % 6) * 0.02 }}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Palomita que aparece ---------- */

/** Palomita en un círculo que «revienta» al marcar (y se va al desmarcar). */
export function TickBadge({ on, className = "" }: { on: boolean; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {on && (
        <motion.span
          key="tick"
          aria-hidden="true"
          className={`relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm ${className}`}
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.2, rotate: -45 }}
          animate={{ opacity: 1, scale: 1, rotate: 0, transition: reduce ? { duration: 0.2 } : { type: "spring", stiffness: 520, damping: 16 } }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.4, transition: { duration: 0.12 } }}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
            <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.25, delay: 0.08 }} />
          </svg>
          <Sparkles count={6} radius={20} size={8} />
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/** Rebote breve cada vez que cambia `k` (contadores «2 de 4», insignias…). */
export function Bump({ k, children, className }: { k: string | number; children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      key={k}
      className={className}
      initial={reduce ? { opacity: 0.4 } : { scale: 1.35 }}
      animate={reduce ? { opacity: 1 } : { scale: 1 }}
      transition={reduce ? { duration: 0.25 } : { type: "spring", stiffness: 500, damping: 14 }}
      style={{ display: "inline-block" }}
    >
      {children}
    </motion.span>
  );
}

export { motion, AnimatePresence, useReducedMotion };
