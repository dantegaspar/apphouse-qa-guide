import { useId } from "react";

/**
 * Gatito gris feliz, chibi estilo anime, para la pantalla de «¡Gracias!» de las encuestas finales.
 *
 * Dibujo propio en SVG + animación CSS: sin Lottie, sin GIF y sin CDN (unos KB dentro del bundle).
 * Rebota, ladea la cabeza, parpadea, mueve la cola y las patitas, y le salen corazones y destellos.
 * Con «reducir movimiento» del sistema no se mueve nada; solo los corazones y destellos aparecen y
 * se desvanecen en su lugar.
 */

const CSS = `
.hc-svg .hc-a{transform-box:fill-box;animation-timing-function:ease-in-out;animation-iteration-count:infinite}
.hc-bounce{transform-origin:50% 100%;animation:hc-bounce 1.4s}
.hc-head{transform-origin:50% 90%;animation:hc-tilt 2.8s}
.hc-tail{transform-origin:0% 100%;animation:hc-tail 1s}
.hc-ear-l{transform-origin:70% 100%;animation:hc-ear 3.2s}
.hc-ear-r{transform-origin:30% 100%;animation:hc-ear 3.2s .4s}
.hc-paw-l{transform-origin:100% 100%;animation:hc-paw-l .7s}
.hc-paw-r{transform-origin:0% 100%;animation:hc-paw-r .7s .35s}
.hc-eye{transform-origin:50% 50%;animation:hc-blink 3.6s}
.hc-pop{transform-origin:50% 50%;opacity:0;animation:hc-pop 2.4s ease-out infinite}
.hc-d2{animation-delay:.8s}.hc-d3{animation-delay:1.6s}.hc-d4{animation-delay:.4s}.hc-d5{animation-delay:1.2s}
@keyframes hc-bounce{0%,100%{transform:translateY(0) scale(1,1)}40%{transform:translateY(-9px) scale(.97,1.03)}75%{transform:translateY(0) scale(1.04,.96)}}
@keyframes hc-tilt{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg)}}
@keyframes hc-tail{0%,100%{transform:rotate(-14deg)}50%{transform:rotate(16deg)}}
@keyframes hc-ear{0%,80%,100%{transform:rotate(0)}88%{transform:rotate(-12deg)}94%{transform:rotate(6deg)}}
@keyframes hc-paw-l{0%,100%{transform:rotate(0)}50%{transform:rotate(-24deg)}}
@keyframes hc-paw-r{0%,100%{transform:rotate(0)}50%{transform:rotate(24deg)}}
@keyframes hc-blink{0%,90%,100%{transform:scaleY(1)}94%{transform:scaleY(.08)}}
@keyframes hc-pop{0%{opacity:0;transform:translateY(8px) scale(.4)}20%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0;transform:translateY(-30px) scale(.8)}}
@keyframes hc-fade{0%,100%{opacity:0}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){
  .hc-svg .hc-a{animation:none}
  .hc-pop{animation:hc-fade 2.4s ease-in-out infinite}
}
`;

const FUR = "#BCC3CE";
const FUR_DARK = "#8F98A6";
const CREAM = "#F5F6F8";
const INK = "#2E3440";
const PINK = "#F9A8D4";
const HOT_PINK = "#F472B6";

function Heart({ x, y, s = 1, cls }: { x: number; y: number; s?: number; cls: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path className={`hc-pop ${cls}`} d="M0 6 C-8 0 -8 -7 -3.5 -7 C-1.5 -7 0 -5.5 0 -4 C0 -5.5 1.5 -7 3.5 -7 C8 -7 8 0 0 6 Z" fill={HOT_PINK} />
    </g>
  );
}

function Sparkle({ x, y, s = 1, cls }: { x: number; y: number; s?: number; cls: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path className={`hc-pop ${cls}`} d="M0 -8 Q1.5 -1.5 8 0 Q1.5 1.5 0 8 Q-1.5 1.5 -8 0 Q-1.5 -1.5 0 -8 Z" fill="#FBBF24" />
    </g>
  );
}

/** Ojo grande de anime: iris con degradado y dos brillos. */
function Eye({ cx, cy, grad }: { cx: number; cy: number; grad: string }) {
  return (
    <g className="hc-a hc-eye">
      <ellipse cx={cx} cy={cy} rx="14" ry="17" fill={`url(#${grad})`} />
      <ellipse cx={cx} cy={cy + 7} rx="8" ry="5" fill="#7C8BB8" opacity=".55" />
      <circle cx={cx + 5} cy={cy - 6} r="6" fill="#fff" />
      <circle cx={cx - 5} cy={cy + 7} r="2.6" fill="#fff" />
    </g>
  );
}

export function HappyCat({ size = 132, className = "" }: { size?: number; className?: string }) {
  const grad = `hc-iris-${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} className={`hc-svg ${className}`} role="img" aria-label="Gatito feliz" data-testid="happy-cat">
      <style>{CSS}</style>
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1F2433" />
          <stop offset="1" stopColor="#3B4A73" />
        </linearGradient>
      </defs>

      {/* sombra */}
      <ellipse cx="100" cy="189" rx="40" ry="6" fill="#000" opacity=".08" />

      {/* corazones y destellos */}
      <Heart x={24} y={60} s={1.3} cls="hc-d1" />
      <Heart x={178} y={52} s={1.1} cls="hc-d2" />
      <Heart x={22} y={120} s={0.9} cls="hc-d3" />
      <Sparkle x={176} y={110} s={0.9} cls="hc-d4" />
      <Sparkle x={40} y={28} s={0.7} cls="hc-d5" />

      <g className="hc-a hc-bounce">
        {/* cola (detrás del cuerpo) */}
        <path className="hc-a hc-tail" d="M120 176 C140 176 152 164 152 148 C152 140 160 136 164 142 C170 158 158 186 124 186 Z" fill={FUR_DARK} />

        {/* cuerpo chiquito */}
        <ellipse cx="100" cy="164" rx="30" ry="24" fill={FUR} />
        <ellipse cx="100" cy="168" rx="17" ry="14" fill={CREAM} />
        <ellipse cx="86" cy="185" rx="10" ry="6" fill={CREAM} />
        <ellipse cx="114" cy="185" rx="10" ry="6" fill={CREAM} />

        {/* patitas arriba, celebrando */}
        <g className="hc-a hc-paw-l">
          <path d="M76 168 C66 162 58 154 56 148 C54 142 60 139 65 142 C71 146 77 152 82 158 Z" fill={FUR} />
          <ellipse cx="59" cy="145" rx="6" ry="5.5" fill={CREAM} />
        </g>
        <g className="hc-a hc-paw-r">
          <path d="M124 168 C134 162 142 154 144 148 C146 142 140 139 135 142 C129 146 123 152 118 158 Z" fill={FUR} />
          <ellipse cx="141" cy="145" rx="6" ry="5.5" fill={CREAM} />
        </g>

        {/* cabeza grande (chibi) */}
        <g className="hc-a hc-head">
          <g className="hc-a hc-ear-l">
            <path d="M40 72 L46 18 L86 44 Z" fill={FUR} strokeLinejoin="round" stroke={FUR} strokeWidth="8" />
            <path d="M50 62 L53 32 L76 47 Z" fill={PINK} />
          </g>
          <g className="hc-a hc-ear-r">
            <path d="M160 72 L154 18 L114 44 Z" fill={FUR} strokeLinejoin="round" stroke={FUR} strokeWidth="8" />
            <path d="M150 62 L147 32 L124 47 Z" fill={PINK} />
          </g>

          <ellipse cx="100" cy="92" rx="68" ry="56" fill={FUR} />
          {/* rayitas */}
          <g stroke={FUR_DARK} strokeWidth="4" strokeLinecap="round" fill="none">
            <path d="M100 38 L100 50" />
            <path d="M88 40 L91 50" />
            <path d="M112 40 L109 50" />
          </g>
          {/* hocico claro */}
          <ellipse cx="100" cy="122" rx="26" ry="16" fill={CREAM} />

          <Eye cx={70} cy={98} grad={grad} />
          <Eye cx={130} cy={98} grad={grad} />

          {/* chapitas con rayitas de anime */}
          <ellipse cx="52" cy="122" rx="11" ry="6.5" fill={PINK} opacity=".85" />
          <ellipse cx="148" cy="122" rx="11" ry="6.5" fill={PINK} opacity=".85" />
          <g stroke={HOT_PINK} strokeWidth="1.8" strokeLinecap="round" opacity=".7">
            <path d="M47 125 L50 119" />
            <path d="M52 125 L55 119" />
            <path d="M57 125 L60 119" />
            <path d="M143 125 L146 119" />
            <path d="M148 125 L151 119" />
            <path d="M153 125 L156 119" />
          </g>

          {/* nariz y boquita abierta feliz */}
          <path d="M97 112 L103 112 L100 115.5 Z" fill={HOT_PINK} strokeLinejoin="round" stroke={HOT_PINK} strokeWidth="2" />
          <path d="M100 116 Q100 124 92 122" stroke={INK} strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <path d="M100 116 Q100 124 108 122" stroke={INK} strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <path d="M94 124 Q100 134 106 124 Q100 126 94 124 Z" fill="#E5566F" />

          {/* bigotes */}
          <g stroke={INK} strokeWidth="1.8" strokeLinecap="round" opacity=".45">
            <path d="M34 108 L22 104" />
            <path d="M34 114 L21 116" />
            <path d="M166 108 L178 104" />
            <path d="M166 114 L179 116" />
          </g>
        </g>
      </g>
    </svg>
  );
}
