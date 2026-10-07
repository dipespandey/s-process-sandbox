import { BookOpen, FileStack, Grid3x3, Landmark, LineChart, PlusCircle, Sigma, SlidersHorizontal, UserRound } from "lucide-react";
import type { Tab } from "@/lib/store";

export const TABS: { id: Tab; label: string; short: string; icon: typeof BookOpen }[] = [
  { id: "overview", label: "Σ Overview", short: "Σ Overview", icon: Sigma },
  { id: "recommender", label: "Recommender", short: "Recommender", icon: UserRound },
  { id: "application", label: "Application", short: "Application", icon: FileStack },
  { id: "funders", label: "Funders", short: "Funders", icon: Landmark },
  { id: "matrix", label: "Disagreement matrix", short: "Disagreement", icon: Grid3x3 },
  { id: "path", label: "Budget path", short: "Path", icon: LineChart },
  { id: "further", label: "Further opportunities", short: "+$5M / +$15M", icon: PlusCircle },
  { id: "sensitivity", label: "Sensitivity", short: "Sensitivity", icon: SlidersHorizontal },
  { id: "method", label: "Method", short: "Method", icon: BookOpen },
];
