"use client";

import { Toaster as SileoToaster } from "sileo";

type ToasterProps = React.ComponentProps<typeof SileoToaster>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <SileoToaster
      position="bottom-center"
      offset={{ bottom: 20 }}
      options={{
        fill: "#111214",
        roundness: 18,
        autopilot: { expand: 180, collapse: 4800 },
      }}
      {...props}
    />
  );
};

export { Toaster };
