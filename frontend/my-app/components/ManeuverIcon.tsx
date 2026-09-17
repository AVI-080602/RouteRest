import {
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  Navigation2,
  Redo2,
  RotateCw,
  type LucideIcon,
} from "lucide-react";
import { ManeuverKind } from "@/utils/navigationSteps";

/**
 * The arrow for a turn instruction. Directions are drawn for driving on
 * the left, as in Australia: traffic goes clockwise round a roundabout,
 * and a U-turn swings back to the right.
 */
const ICON_BY_KIND: Record<ManeuverKind, LucideIcon> = {
  depart: Navigation2,
  left: CornerUpLeft,
  right: CornerUpRight,
  "sharp-left": CornerUpLeft,
  "sharp-right": CornerUpRight,
  "slight-left": ArrowUpLeft,
  "slight-right": ArrowUpRight,
  "keep-left": ArrowUpLeft,
  "keep-right": ArrowUpRight,
  straight: ArrowUp,
  roundabout: RotateCw,
  "exit-roundabout": RotateCw,
  "u-turn": Redo2,
  arrive: Flag,
};

type Props = {
  kind: ManeuverKind;
  className?: string;
};

export default function ManeuverIcon({ kind, className = "h-6 w-6" }: Props) {
  const Icon = ICON_BY_KIND[kind];
  return <Icon className={className} aria-hidden />;
}
