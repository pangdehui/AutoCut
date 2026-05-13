import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface VoiceOption {
  value: string;
  label: string;
}

export const ALL_VOICES: VoiceOption[] = [
  { value: "male-qn-qingse", label: "青涩青年" },
  { value: "male-qn-jingying", label: "精英青年" },
  { value: "male-qn-badao", label: "霸道青年" },
  { value: "male-qn-daxuesheng", label: "青年大学生" },
  { value: "female-shaonv", label: "少女" },
  { value: "female-yujie", label: "御姐" },
  { value: "female-chengshu", label: "成熟女性" },
  { value: "female-tianmei", label: "甜美女性" },
  { value: "clever_boy", label: "聪明男童" },
  { value: "cute_boy", label: "可爱男童" },
  { value: "lovely_girl", label: "萌萌女童" },
  { value: "cartoon_pig", label: "卡通猪小琪" },
  { value: "bingjiao_didi", label: "病娇弟弟" },
  { value: "junlang_nanyou", label: "俊朗男友" },
  { value: "chunzhen_xuedi", label: "纯真学弟" },
  { value: "lengdan_xiongzhang", label: "冷淡学长" },
  { value: "badao_shaoye", label: "霸道少爷" },
  { value: "tianxin_xiaoling", label: "甜心小玲" },
  { value: "qiaopi_mengmei", label: "俏皮萌妹" },
  { value: "wumei_yujie", label: "妩媚御姐" },
  { value: "diadia_xuemei", label: "嗲嗲学妹" },
  { value: "danya_xuejie", label: "淡雅学姐" },
  { value: "Chinese (Mandarin)_Reliable_Executive", label: "沉稳高管" },
  { value: "Chinese (Mandarin)_News_Anchor", label: "新闻女声" },
  { value: "Chinese (Mandarin)_Mature_Woman", label: "傲娇御姐" },
  { value: "Chinese (Mandarin)_Unrestrained_Young_Man", label: "不羁青年" },
  { value: "Arrogant_Miss", label: "嚣张小姐" },
  { value: "Robot_Armor", label: "机械战甲" },
  { value: "Chinese (Mandarin)_Kind-hearted_Antie", label: "热心大婶" },
  { value: "Chinese (Mandarin)_HK_Flight_Attendant", label: "港普空姐" },
  { value: "Chinese (Mandarin)_Humorous_Elder", label: "搞笑大爷" },
  { value: "Chinese (Mandarin)_Gentleman", label: "温润男声" },
  { value: "Chinese (Mandarin)_Warm_Bestie", label: "温暖闺蜜" },
  { value: "Chinese (Mandarin)_Male_Announcer", label: "播报男声" },
  { value: "Chinese (Mandarin)_Sweet_Lady", label: "甜美女声" },
  { value: "Chinese (Mandarin)_Southern_Young_Man", label: "南方小哥" },
  { value: "Chinese (Mandarin)_Wise_Women", label: "阅历姐姐" },
  { value: "Chinese (Mandarin)_Gentle_Youth", label: "温润青年" },
  { value: "Chinese (Mandarin)_Warm_Girl", label: "温暖少女" },
  { value: "Chinese (Mandarin)_Kind-hearted_Elder", label: "花甲奶奶" },
  { value: "Chinese (Mandarin)_Cute_Spirit", label: "憨憨萌兽" },
  { value: "Chinese (Mandarin)_Radio_Host", label: "电台男主播" },
  { value: "Chinese (Mandarin)_Lyrical_Voice", label: "抒情男声" },
  { value: "Chinese (Mandarin)_Straightforward_Boy", label: "率真弟弟" },
  { value: "Chinese (Mandarin)_Sincere_Adult", label: "真诚青年" },
  { value: "Chinese (Mandarin)_Gentle_Senior", label: "温柔学姐" },
  { value: "Chinese (Mandarin)_Stubborn_Friend", label: "嘴硬竹马" },
  { value: "Chinese (Mandarin)_Crisp_Girl", label: "清脆少女" },
  { value: "Chinese (Mandarin)_Pure-hearted_Boy", label: "清澈邻家弟弟" },
  { value: "Chinese (Mandarin)_Soft_Girl", label: "柔和少女" },
  { value: "Cantonese_ProfessionalHost（F)", label: "粤语 专业女主持" },
  { value: "Cantonese_GentleLady", label: "粤语 温柔女声" },
  { value: "Cantonese_ProfessionalHost（M)", label: "粤语 专业男主持" },
  { value: "Cantonese_PlayfulMan", label: "粤语 活泼男声" },
  { value: "Cantonese_CuteGirl", label: "粤语 可爱女孩" },
  { value: "Cantonese_KindWoman", label: "粤语 善良女声" },
];

type Group = "male" | "female" | "child" | "cantonese" | "other";

const GROUP_LABEL: Record<Group, string> = {
  male: "男声",
  female: "女声",
  child: "童声 / 卡通",
  cantonese: "粤语",
  other: "其他",
};

const GROUP_ORDER: Group[] = ["female", "male", "cantonese", "child", "other"];

function classify(v: VoiceOption): Group {
  if (v.value.startsWith("Cantonese_")) return "cantonese";
  const label = v.label;
  if (/(童|萌兽|卡通|猪)/.test(label)) return "child";
  if (
    /(青年|男友|学长|少爷|学弟|高管|男声|大爷|男主播|青年大学生|男童|空|男士|男 |搞笑大爷|播报男声)/.test(label) ||
    v.value.startsWith("male-") ||
    /Boy|Man|Male|Gentleman|Executive|Anchor.*?(?!女)/i.test(v.value)
  ) {
    return "male";
  }
  if (
    /(女|姐|妹|小姐|奶奶|大婶|空姐|闺蜜|学妹|学姐|女声|女主持|少女|御姐|甜心|萌妹|阅历)/.test(label) ||
    v.value.startsWith("female-") ||
    /Girl|Woman|Lady|Miss|Antie|Elder.*?(?:_F|Female)|F\)$/.test(v.value)
  ) {
    return "female";
  }
  return "other";
}

interface VoicePickerProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

export default function VoicePicker({
  value,
  onChange,
  disabled,
  className,
  placeholder = "选择音色",
}: VoicePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = ALL_VOICES.find((v) => v.value === value);

  const grouped = useMemo(() => {
    const map: Record<Group, VoiceOption[]> = {
      male: [], female: [], child: [], cantonese: [], other: [],
    };
    for (const v of ALL_VOICES) map[classify(v)].push(v);
    return map;
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", className)}
        >
          <span className="truncate">
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command
          filter={(itemValue, search) => {
            const text = itemValue.toLowerCase();
            return text.includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="搜索音色..." />
          <CommandList className="max-h-72">
            <CommandEmpty>没有匹配的音色</CommandEmpty>
            {GROUP_ORDER.map((g) => {
              const items = grouped[g];
              if (items.length === 0) return null;
              return (
                <CommandGroup key={g} heading={`${GROUP_LABEL[g]}（${items.length}）`}>
                  {items.map((v) => (
                    <CommandItem
                      key={v.value}
                      value={`${v.label} ${v.value}`}
                      onSelect={() => {
                        onChange(v.value);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          value === v.value ? "opacity-100" : "opacity-0"
                        )}
                      />
                      {v.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
