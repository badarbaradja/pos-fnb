import { getProductAvatarColors, getProductInitials } from "@/lib/products/initials";
import { cn } from "@/lib/utils";

export function ProductInitialsAvatar({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const colors = getProductAvatarColors(name);
  return (
    <div
      className={cn(
        "flex aspect-square w-full items-center justify-center rounded-md text-sm font-semibold",
        className
      )}
      style={{ backgroundColor: colors.background, color: colors.foreground }}
    >
      {getProductInitials(name)}
    </div>
  );
}
