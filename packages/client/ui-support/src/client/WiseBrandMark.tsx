/**
 * Hosted WiseAI brand mark: an orange rounded square with the white W. It
 * replaces the whale artwork in the sidebar header and the blank-home greeting.
 * @module @deepseek-ai/dsh-client-ui-support/client/WiseBrandMark
 */

/** Presentation accepted by both brand-mark slots. */
export interface WiseBrandMarkProps {
  /** Requested square edge in pixels. */
  readonly size: number
  /** Host class preserving the surrounding mark geometry. */
  readonly className?: string | undefined
}

/**
 * Render the hosted brand mark.
 * @param props - requested size and host class.
 * @returns the W mark as an inline SVG.
 */
export function WiseBrandMark({ size, className }: WiseBrandMarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="22" height="22" rx="6" fill="#eb6c2c" />
      <text
        x="12"
        y="17"
        textAnchor="middle"
        fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
        fontSize="14"
        fontWeight="700"
        fill="#ffffff"
      >W</text>
    </svg>
  )
}
