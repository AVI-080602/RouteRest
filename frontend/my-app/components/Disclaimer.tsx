/**
 * The one-line legal framing the BA asked for (item 7): RouteRest advises,
 * the driver decides, and the NHVR rules always win. Shown wherever the
 * app hands the driver a plan or an instruction, so it is never more than
 * a glance away when they act on one.
 */
export default function Disclaimer({ className = "" }: { className?: string }) {
  return (
    <p className={`text-center text-xs text-muted ${className}`}>
      RouteRest provides supporting guidance only. Drivers must follow the NHVR
      work and rest rules and use their own judgement based on actual
      conditions.
    </p>
  );
}
