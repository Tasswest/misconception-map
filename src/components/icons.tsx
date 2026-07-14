import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const baseProps = {
  "aria-hidden": true,
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  strokeWidth: 1.8,
  viewBox: "0 0 24 24",
};

export function GridIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <rect height="7" rx="2" width="7" x="3" y="3" />
      <rect height="7" rx="2" width="7" x="14" y="3" />
      <rect height="7" rx="2" width="7" x="3" y="14" />
      <rect height="7" rx="2" width="7" x="14" y="14" />
    </svg>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function ClipboardIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <rect height="18" rx="2" width="16" x="4" y="4" />
      <path d="M9 4V2h6v2M8 10h8M8 14h5" />
    </svg>
  );
}

export function SparkIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="m12 3-1.2 4.1a5.5 5.5 0 0 1-3.7 3.7L3 12l4.1 1.2a5.5 5.5 0 0 1 3.7 3.7L12 21l1.2-4.1a5.5 5.5 0 0 1 3.7-3.7L21 12l-4.1-1.2a5.5 5.5 0 0 1-3.7-3.7L12 3Z" />
    </svg>
  );
}

export function ArrowIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}
