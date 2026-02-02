import { HTMLAttributes, forwardRef } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  selected?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ selected, className = "", children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`
          bg-bg-surface rounded-lg border transition-colors
          ${selected ? "border-accent" : "border-border-default hover:border-border-strong"}
          ${className}
        `}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = "Card";
