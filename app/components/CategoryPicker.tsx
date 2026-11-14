"use client";

export type PickerPosition = { top: number; left: number; width: number };

/** 버튼 위치 기준으로 팝업 자리를 잡습니다(아래 공간이 모자라면 위로). */
export function pickerPositionFrom(rect: DOMRect): PickerPosition {
  const width = Math.min(440, window.innerWidth - 24);
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
  const estimatedHeight = 300;
  const top =
    rect.bottom + estimatedHeight <= window.innerHeight
      ? rect.bottom + 6
      : Math.max(12, rect.top - estimatedHeight - 6);
  return { top, left, width };
}

/** 대분류 선택 버튼(현재 값 ▾). 상세내역·달력이 같은 모양을 씁니다. */
export function CategoryButton({
  value,
  open,
  disabled,
  onClick,
}: {
  value: string;
  open: boolean;
  disabled?: boolean;
  onClick: (rect: DOMRect) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick(event.currentTarget.getBoundingClientRect());
      }}
      className="inline-flex min-w-28 items-center justify-between gap-2 rounded border border-zinc-200 bg-white px-2 py-1 text-left text-xs hover:border-emerald-500 hover:bg-emerald-50 disabled:opacity-50"
    >
      <span>{value}</span>
      <span className="text-zinc-400">{open ? "▴" : "▾"}</span>
    </button>
  );
}

/** 대분류 선택 팝업(4열 버튼 격자, 가나다순은 넘겨받은 categories 순서). */
export default function CategoryPicker({
  categories,
  current,
  position,
  disabled,
  onPick,
  onClose,
}: {
  categories: string[];
  current: string;
  position: PickerPosition;
  disabled?: boolean;
  onPick: (category: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      <button
        type="button"
        aria-label="대분류 선택 닫기"
        className="fixed inset-0 z-40 cursor-default bg-transparent"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="대분류 선택"
        className="fixed z-50 rounded-xl border border-zinc-200 bg-white p-3 shadow-2xl"
        style={position}
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-xs font-semibold text-zinc-800">대분류 선택</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          >
            닫기
          </button>
        </div>
        <div className="grid max-h-64 grid-cols-4 gap-1.5 overflow-y-auto">
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              disabled={disabled}
              onClick={() => onPick(category)}
              className={`truncate rounded-md border px-2 py-2 text-xs ${
                category === current
                  ? "border-emerald-600 bg-emerald-600 font-semibold text-white"
                  : "border-zinc-200 bg-white text-zinc-700 hover:border-emerald-400 hover:bg-emerald-50"
              }`}
              title={category}
            >
              {category}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
