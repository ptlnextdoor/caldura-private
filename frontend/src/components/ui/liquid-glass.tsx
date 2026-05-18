"use client";

import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

type LiquidGlassProps = {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  interactive?: boolean;
  style?: CSSProperties;
};

export function LiquidGlass({
  children,
  className,
  contentClassName,
  interactive = false,
  style,
}: LiquidGlassProps) {
  const glassStyle: CSSProperties = {
    boxShadow: "0 6px 6px rgba(0, 0, 0, 0.2), 0 0 20px rgba(0, 0, 0, 0.1)",
    transitionTimingFunction: "cubic-bezier(0.175, 0.885, 0.32, 2.2)",
    ...style,
  };

  return (
    <div
      className={cn(
        "liquid-glass relative flex overflow-hidden text-black transition-all duration-700",
        interactive && "cursor-pointer",
        className,
      )}
      style={glassStyle}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 z-0 overflow-hidden"
        style={{
          borderRadius: "inherit",
          backdropFilter: "blur(3px)",
          filter: "url(#glass-distortion)",
          isolation: "isolate",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 z-10"
        style={{
          borderRadius: "inherit",
          background: "rgba(255, 255, 255, 0.25)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 z-20 overflow-hidden"
        style={{
          borderRadius: "inherit",
          boxShadow:
            "inset 2px 2px 1px 0 rgba(255, 255, 255, 0.5), inset -1px -1px 1px 1px rgba(255, 255, 255, 0.5)",
        }}
      />
      <div className={cn("relative z-30", contentClassName)}>{children}</div>
    </div>
  );
}

export function LiquidGlassFilter() {
  return (
    <svg
      aria-hidden="true"
      className="liquid-glass-filter"
      focusable="false"
      width="0"
      height="0"
    >
      <filter
        id="glass-distortion"
        x="0%"
        y="0%"
        width="100%"
        height="100%"
        filterUnits="objectBoundingBox"
      >
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.001 0.005"
          numOctaves="1"
          seed="17"
          result="turbulence"
        />
        <feComponentTransfer in="turbulence" result="mapped">
          <feFuncR type="gamma" amplitude="1" exponent="10" offset="0.5" />
          <feFuncG type="gamma" amplitude="0" exponent="1" offset="0" />
          <feFuncB type="gamma" amplitude="0" exponent="1" offset="0.5" />
        </feComponentTransfer>
        <feGaussianBlur in="turbulence" stdDeviation="3" result="softMap" />
        <feSpecularLighting
          in="softMap"
          surfaceScale="5"
          specularConstant="1"
          specularExponent="100"
          lightingColor="white"
          result="specLight"
        >
          <fePointLight x="-200" y="-200" z="300" />
        </feSpecularLighting>
        <feComposite
          in="specLight"
          operator="arithmetic"
          k1="0"
          k2="1"
          k3="1"
          k4="0"
          result="litImage"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="softMap"
          scale="200"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </svg>
  );
}
