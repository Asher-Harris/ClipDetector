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
          bg-zinc-900 rounded-lg border transition-colors
          ${selected ? "border-blue-500" : "border-zinc-800 hover:border-zinc-700"}
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
