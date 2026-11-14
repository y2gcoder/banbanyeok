"use client";

// shadcn/ui base-nova combobox를 바탕으로 이 앱에서 쓰는 부분만 남기고 토큰에 맞춰 고쳤다.
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const Combobox = ComboboxPrimitive.Root;

function ComboboxInput({
  className,
  showClear = false,
  ...props
}: ComboboxPrimitive.Input.Props & { showClear?: boolean }) {
  return (
    <div data-slot="combobox-input-group" className="relative flex w-full items-center">
      <ComboboxPrimitive.Input
        data-slot="combobox-input"
        className={cn(
          "h-12 w-full min-w-0 rounded-lg border border-input bg-surface px-3.5 text-[17px] font-semibold text-ink outline-none transition-colors placeholder:font-normal placeholder:text-muted-foreground focus-visible:border-ink focus-visible:outline-none aria-invalid:border-destructive",
          showClear && "pr-11",
          className,
        )}
        {...props}
      />
      {showClear ? (
        <ComboboxPrimitive.Clear
          data-slot="combobox-clear"
          className="absolute right-1.5 inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-ink"
        >
          <XIcon className="size-4" aria-hidden="true" />
        </ComboboxPrimitive.Clear>
      ) : null}
    </div>
  );
}

function ComboboxContent({ className, ...props }: ComboboxPrimitive.Popup.Props) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner side="bottom" sideOffset={6} align="start" className="isolate z-50">
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className={cn(
            "max-h-(--available-height) w-(--anchor-width) max-w-(--available-width) origin-(--transform-origin) overflow-hidden rounded-lg border border-rule bg-popover text-popover-foreground shadow-[0_12px_32px_-12px_rgb(22_32_27/0.35)] duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
            className,
          )}
          {...props}
        />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  );
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      className={cn("max-h-80 scroll-py-1 overflow-y-auto overscroll-contain p-1 data-empty:p-0", className)}
      {...props}
    />
  );
}

function ComboboxItem({ className, ...props }: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        "flex w-full cursor-default items-center gap-2 rounded-md px-2.5 py-2 outline-hidden select-none data-highlighted:bg-accent data-disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    />
  );
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn("px-3 py-3 text-sm text-muted-foreground empty:hidden", className)}
      {...props}
    />
  );
}

export { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList };
