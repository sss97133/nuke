import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * A utility function that merges multiple class names or class value arrays into a single string.
 * It combines the functionality of clsx and tailwind-merge to handle conditional classes and resolve
 * Tailwind CSS conflicts.
 * 
 * @example
 * ```tsx
 * // Basic usage with string classes
 * <div className={cn("text-red-500", "bg-blue-500")} />
 * 
 * // With conditional classes
 * <div className={cn("text-lg", isActive && "font-bold", isBig ? "p-4" : "p-2")} />
 * 
 * // Resolving Tailwind conflicts (last one wins)
 * <div className={cn("px-2 py-1", "p-4")} /> // Results in "p-4"
 * ```
 * 
 * @param inputs Any number of class values (strings, objects, arrays)
 * @returns A merged className string with conflicts resolved
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
