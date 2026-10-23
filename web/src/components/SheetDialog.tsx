import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Dialog, TextButton } from "./md";

// 原生 MD3 对话框壳：封装 @material/web 的 <md-dialog>（内部为原生 <dialog>.showModal()）。
// - 定位：浏览器顶层 layer 居中，不随页面/祖先 transform 偏移
// - 动画：打开/关闭（淡入 + 缩放）为组件官方实现，符合 MD3 emphasized 缓动
// - 遮罩：32% scrim，点击遮罩或按 Esc 关闭
// - 滚动：内容超出时对话框内容区原生滚动（顶部/底部自动显示分割线），后方页面由原生模态锁定
// - 关闭：先播完退出动画，再通知父级卸载
// - 卡头：与威能/物品/专长卡同语言的彩色头（headColor 传规则色如 ITEM_COLOR，默认主色）
// - 宽度：默认 760px（sheet-dialog），xwide 880px（sheet-dialog-xw）
export default function SheetDialog(props: {
  open: boolean;
  headline: string;
  sub?: string;        // 卡头右侧 meta（对应 pc-meta/ic-meta）
  headColor?: string;  // 卡头底色（如 ITEM_COLOR 物品橙）；默认跟随主色
  headFg?: string;     // 卡头文字色；给了 headColor 时默认白色
  xwide?: boolean;     // 加宽变体（880px，供双栏内容如基础物品选择）
  extraClass?: string; // 追加到 md-dialog 上的自定义类（用于个别弹窗定制宽度等）
  noCloseButton?: boolean;   // 不渲染默认「关闭」按钮（调用方自带完整操作，如升级属性弹窗）
  preventScrimClose?: boolean; // 点遮罩 / 按 Esc 不关闭：给「必须先做一个明确选择」的对话框用
  onClose: () => void;
  children: ReactNode;   // slot="content"
  actions?: ReactNode;   // slot="actions"（额外的操作按钮，默认附带「关闭」）
}) {
  const [visible, setVisible] = useState(props.open);

  useEffect(() => {
    setVisible(props.open);
  }, [props.open]);

  const close = () => setVisible(false);

  const headStyle: CSSProperties | undefined =
    props.headColor || props.headFg
      ? ({
          "--sheet-dialog-head-color": props.headColor,
          "--sheet-dialog-head-fg": props.headFg ?? "#fff",
        } as CSSProperties)
      : undefined;

  return (
    <Dialog
      className={"sheet-dialog" + (props.xwide ? " sheet-dialog-xw" : "") + (props.extraClass ? " " + props.extraClass : "")}
      open={visible}
      onClose={close}
      // 遮罩点击 / Esc 会先派发可取消的 cancel；preventDefault 即拦下这次关闭。
      // md-dialog 内部只在没人 preventDefault 时才走关闭动画（见 @material/web dialog）。
      onCancel={(e: Event) => {
        if (props.preventScrimClose) e.preventDefault();
      }}
      onClosed={() => {
        if (!visible && props.open) props.onClose();
      }}
    >
      <div slot="headline" className="sheet-dialog-head" style={headStyle}>
        <span className="sheet-dialog-title">{props.headline}</span>
        {props.sub && <span className="sheet-dialog-sub">{props.sub}</span>}
      </div>
      <div slot="content">{props.children}</div>
      <div slot="actions">
        {props.actions}
        {!props.noCloseButton && <TextButton onClick={close}>关闭</TextButton>}
      </div>
    </Dialog>
  );
}
