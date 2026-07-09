import { inputClass } from "@/components/FormField";
import type { DiscountInfo } from "@/lib/invoice";

/** Amount/percent pair used for both the before-tax and after-tax discount fields. */
export function DiscountInput({ value, onChange }: { value: DiscountInfo; onChange: (next: DiscountInfo) => void }) {
  return (
    <div className="flex gap-2">
      <input
        type="number"
        step="0.01"
        min={0}
        className={`${inputClass} w-24 text-right`}
        value={value.value}
        onChange={(e) => onChange({ ...value, value: Number(e.target.value) })}
      />
      <select
        className={`${inputClass} w-16 flex-none`}
        value={value.type}
        onChange={(e) => onChange({ ...value, type: e.target.value as DiscountInfo["type"] })}
      >
        <option value="amount">₹</option>
        <option value="percent">%</option>
      </select>
    </div>
  );
}
