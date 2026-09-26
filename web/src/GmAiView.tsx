// 主持页 · AI。
//
// 主持侧的 AI 是个**待接入**的功能：这一页现在只把玩家 AI 车卡页的顶栏搬过来
// —— 「连接配置」（供应商 / 模型 / Key / 接口地址 + 测试连接）与那句意图的文字输入。
// 两步走是刻意的：
//   1. 连接配置属于应用级设置（落在 lib/ai/config，与玩家页同一份），先把入口摆到主持侧，
//      城主随时能在这一页把接口接通、当场验证（测试连接会真的发一次最小请求）；
//   2. 输入框里的意图先留着，接入生成时直接接上这一句，不必再改版面。
//
// 顶栏本体是 components/AiSetupBar —— 与 AiView 共用同一份实现，不复制一套：
// 两页对「同一个接口地址为什么连不上」必须给同一句解释。
// 这一页不传 cfg：配置由顶栏自己持有（主持侧暂时没有要读它的调用方）。

import AiSetupBar from "./components/AiSetupBar";

export default function GmAiView() {
  return (
    <div className="ai-view gm-ai">
      <AiSetupBar
        title="AI 助手"
        placeholder="想做什么？"
        hint="连接已在下方配置，与玩家模式的「AI 车卡」共用同一份设置。具体的主持侧功能尚未接入，此页目前只提供连接配置与这段输入。"
      />
    </div>
  );
}
