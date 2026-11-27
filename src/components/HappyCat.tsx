/**
 * Gatito feliz (kawaii) para la pantalla de «¡Gracias!» de las encuestas finales.
 *
 * Dibujo propio en SVG + animación CSS: sin Lottie, sin GIF y sin CDN (pesa ~4 KB dentro del
 * bundle). Rebota, mueve la cola, las orejas y las patitas, y le salen corazones.
 * Con «reducir movimiento» del sistema no se mueve nada; solo los corazones aparecen y se
 * desvanecen en su lugar.
 */

const CSS = `
.hc-svg .hc-a{transform-box:fill-box;animation-timing-function:ease-in-out;animation-iteration-count:infinite}
.hc-bounce{transform-origin:50% 100%;animation:hc-bounce 1.4s}
.hc-tail{transform-origin:0% 100%;animation:hc-tail 1s}
.hc-ear-l{transform-origin:70% 100%;animation:hc-ear 2.8s}
.hc-ear-r{transform-origin:30% 100%;animation:hc-ear 2.8s .35s}
.hc-paw-l{transform-origin:100% 100%;animation:hc-paw-l .7s}
.hc-paw-r{transform-origin:0% 100%;animation:hc-paw-r .7s .35s}
.hc-heart{transform-origin:50% 50%;opacity:0;animation:hc-heart 2.4s ease-out infinite}
.hc-h2{animation-delay:.8s}.hc-h3{animation-delay:1.6s}
@keyframes hc-bounce{0%,100%{transform:translateY(0) scale(1,1)}40%{transform:translateY(-9px) scale(.97,1.03)}75%{transform:translateY(0) scale(1.04,.96)}}
@keyframes hc-tail{0%,100%{transform:rotate(-12deg)}50%{transform:rotate(16deg)}}
@keyframes hc-ear{0%,80%,100%{transform:rotate(0)}88%{transform:rotate(-10deg)}94%{transform:rotate(6deg)}}
@keyframes hc-paw-l{0%,100%{transform:rotate(0)}50%{transform:rotate(-22deg)}}
@keyframes hc-paw-r{0%,100%{transform:rotate(0)}50%{transform:rotate(22deg)}}
@keyframes hc-heart{0%{opacity:0;transform:translateY(8px) scale(.4)}20%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0;transform:translateY(-34px) scale(.8)}}
@keyframes hc-fade{0%,100%{opacity:0}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){
  .hc-svg .hc-a{animation:none}
  .hc-heart{animation:hc-fade 2.4s ease-in-out infinite}
}
`;

const FUR = "#FDBA74";
const FUR_DARK = "#FB923C";
const CREAM = "#FFF7ED";
const INK = "#3F2A1E";
const PINK = "#F9A8D4";

function Heart({ x, y, s = 1, cls }: { x: number; y: number; s?: number; cls: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path
        className={`hc-heart ${cls}`}
        d="M0 6 C-8 0 -8 -7 -3.5 -7 C-1.5 -7 0 -5.5 0 -4 C0 -5.5 1.5 -7 3.5 -7 C8 -7 8 0 0 6 Z"
        fill="#F472B6"
      />
    </g>
  );
}

export function HappyCat({ size = 132, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      className={`hc-svg ${className}`}
      role="img"
      aria-label="Gatito feliz"
      data-testid="happy-cat"
    >
      <style>{CSS}</style>
      {/* sombra */}
      <ellipse cx="100" cy="186" rx="48" ry="7" fill="#000" opacity=".08" />

      {/* corazones */}
      <Heart x={40} y={58} s={1.3} cls="hc-h1" />
      <Heart x={162} y={50} s={1.1} cls="hc-h2" />
      <Heart x={30} y={80} s={0.9} cls="hc-h3" />

      <g className="hc-a hc-bounce">
        {/* cola (detrás del cuerpo) */}
        <path
          className="hc-a hc-tail"
          d="M128 166 C150 164 162 150 160 130 C159 120 168 116 172 124 C178 142 166 176 130 178 Z"
          fill={FUR_DARK}
        />

        {/* cuerpo */}
        <ellipse cx="100" cy="150" rx="40" ry="32" fill={FUR} />
        <ellipse cx="100" cy="156" rx="24" ry="20" fill={CREAM} />
        {/* patitas de abajo */}
        <ellipse cx="82" cy="179" rx="11" ry="7" fill={CREAM} />
        <ellipse cx="118" cy="179" rx="11" ry="7" fill={CREAM} />

        {/* patitas arriba, celebrando */}
        <g className="hc-a hc-paw-l">
          <path d="M70 142 C56 136 42 124 38 114 C35 106 43 101 50 106 C58 112 68 122 76 132 Z" fill={FUR} />
          <ellipse cx="42" cy="109" rx="7.5" ry="6.5" fill={CREAM} />
        </g>
        <g className="hc-a hc-paw-r">
          <path d="M130 142 C144 136 158 124 162 114 C165 106 157 101 150 106 C142 112 132 122 124 132 Z" fill={FUR} />
          <ellipse cx="158" cy="109" rx="7.5" ry="6.5" fill={CREAM} />
        </g>

        {/* orejas */}
        <g className="hc-a hc-ear-l">
          <path d="M52 66 L58 22 L90 46 Z" fill={FUR} strokeLinejoin="round" stroke={FUR} strokeWidth="6" />
          <path d="M60 58 L63 34 L80 48 Z" fill={PINK} />
        </g>
        <g className="hc-a hc-ear-r">
          <path d="M148 66 L142 22 L110 46 Z" fill={FUR} strokeLinejoin="round" stroke={FUR} strokeWidth="6" />
          <path d="M140 58 L137 34 L120 48 Z" fill={PINK} />
        </g>

        {/* cabeza */}
        <ellipse cx="100" cy="80" rx="56" ry="46" fill={FUR} />
        {/* rayitas */}
        <path d="M92 36 Q100 44 108 36" stroke={FUR_DARK} strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M96 44 Q100 48 104 44" stroke={FUR_DARK} strokeWidth="3.5" fill="none" strokeLinecap="round" />
        {/* hocico */}
        <ellipse cx="100" cy="96" rx="22" ry="15" fill={CREAM} />

        {/* ojitos felices ^ ^ */}
        <path d="M66 80 Q75 68 84 80" stroke={INK} strokeWidth="5" fill="none" strokeLinecap="round" />
        <path d="M116 80 Q125 68 134 80" stroke={INK} strokeWidth="5" fill="none" strokeLinecap="round" />

        {/* chapitas */}
        <ellipse cx="64" cy="94" rx="10" ry="6" fill={PINK} opacity=".85" />
        <ellipse cx="136" cy="94" rx="10" ry="6" fill={PINK} opacity=".85" />

        {/* nariz y boquita ω */}
        <path d="M96 88 L104 88 L100 93 Z" fill="#F472B6" strokeLinejoin="round" stroke="#F472B6" strokeWidth="2" />
        <path d="M90 97 Q95 104 100 97 Q105 104 110 97" stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />

        {/* bigotes */}
        <g stroke={INK} strokeWidth="2" strokeLinecap="round" opacity=".55">
          <path d="M44 88 L30 84" />
          <path d="M44 96 L29 98" />
          <path d="M156 88 L170 84" />
          <path d="M156 96 L171 98" />
        </g>
      </g>
    </svg>
  );
}
