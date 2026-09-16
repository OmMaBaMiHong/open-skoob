import "../styles/brand.css";

const marks = {
  primary: "/brand/c-book-spark-color.svg",
  mascot: "/brand/b-spark-mascot-color.svg",
  literary: "/brand/a-page-flame-color.svg",
} as const;

export function SkoobLogo({ className, variant = "primary", decorative = false }: {
  readonly className?: string;
  readonly variant?: keyof typeof marks;
  readonly decorative?: boolean;
}) {
  return (
    <img
      src={marks[variant]}
      alt={decorative ? "" : "焚诀"}
      className={["skoob-brand-mark", className].filter(Boolean).join(" ")}
      width={32}
      height={32}
    />
  );
}
