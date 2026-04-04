import React from 'react';
import { Trash2 } from 'lucide-react';

/**
 * Elegant trash control: always visible on small screens, fades in on md+ when parent has `group` and is hovered.
 * Set alwaysVisible for headers (e.g. lead detail) where there is no row hover.
 */
export default function DeleteIconButton({ onClick, label = 'Eliminar', alwaysVisible = false, className = '' }) {
  const reveal =
    alwaysVisible
      ? ''
      : 'opacity-100 pointer-events-auto md:opacity-0 md:pointer-events-none md:group-hover:opacity-100 md:group-hover:pointer-events-auto';

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      aria-label={label}
      title={label}
      className={`
        inline-flex items-center justify-center h-9 w-9 shrink-0 rounded-lg
        border border-white/[0.08] bg-white/[0.03] text-white/45
        hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/[0.12]
        active:scale-[0.97]
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090B]
        transition-all duration-200 ease-out
        ${reveal}
        ${className}
      `.trim().replace(/\s+/g, ' ')}
    >
      <Trash2 size={17} strokeWidth={1.65} className="pointer-events-none" aria-hidden />
    </button>
  );
}
