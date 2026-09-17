import {
  waitForEvenAppBridge,
  type EvenAppBridge,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  ListContainerProperty,
  ListItemContainerProperty,
  TextContainerProperty,
  type List_ItemEvent,
} from '@evenrealities/even_hub_sdk';
import proseData from './data/prose.json';

type ChapterProse = {
  category: string;
  label: string;
  paragraphs: string[];
};

const chapters = proseData as ChapterProse[];

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] as string));
}

// ---------- Book view (phone WebView / plain browser) ----------

function renderBook() {
  const nav = document.getElementById('chapterNav')!;
  const content = document.getElementById('content')!;
  const totalParas = chapters.reduce((n, c) => n + c.paragraphs.length, 0);

  document.getElementById('progressLabel')!.textContent = `全${totalParas}項目・出そうな論点を通し読み`;

  nav.innerHTML =
    `<a class="pill count" href="#top">全${totalParas}項目</a>` +
    chapters.map((c) => `<a class="pill" href="#ch-${c.category}">${c.category}</a>`).join('');

  content.innerHTML = chapters
    .map(
      (c) => `
        <section class="chapter" id="ch-${c.category}">
          <div class="chapter-head">
            <span class="ja">${escapeHtml(c.label)}</span>
            <span class="n">${c.paragraphs.length}項目</span>
          </div>
          ${c.paragraphs
            .map(
              (p, i) => `
            <div class="para">
              <span class="n">${String(i + 1).padStart(2, '0')}</span>
              <div class="t">${escapeHtml(p)}</div>
            </div>`,
            )
            .join('')}
        </section>`,
    )
    .join('');
}

// ---------- Glasses HUD view (EvenG2 lenses, via glassesMenu launch) ----------

const GLASSES_WIDTH = 576;
const GLASSES_HEIGHT = 288;
const PAGE_CHAR_LIMIT = 260; // rough chunk size per HUD screen

type Screen = 'toc' | 'reading';

const glassesState = {
  screen: 'toc' as Screen,
  chapterIndex: 0,
  pageIndex: 0,
};

// Each chapter's paragraphs, pre-split into HUD-sized pages.
let chapterPages: string[][] = [];

function buildChapterPages(): string[][] {
  return chapters.map((c) => {
    const pages: string[] = [];
    let buf = '';
    for (const para of c.paragraphs) {
      const candidate = buf ? `${buf}\n\n${para}` : para;
      if (candidate.length > PAGE_CHAR_LIMIT && buf) {
        pages.push(buf);
        buf = para;
      } else {
        buf = candidate;
      }
    }
    if (buf) pages.push(buf);
    return pages;
  });
}

async function renderToc(bridge: EvenAppBridge, first: boolean) {
  glassesState.screen = 'toc';
  const itemName = chapters.map((c, i) => `${c.category}（全${chapterPages[i].length}ページ）`);

  const listContainer = new ListContainerProperty({
    xPosition: 8,
    yPosition: 8,
    width: GLASSES_WIDTH - 16,
    height: GLASSES_HEIGHT - 16,
    containerID: 1,
    containerName: 'toc-list',
    itemContainer: new ListItemContainerProperty({
      itemCount: itemName.length,
      itemName,
      isItemSelectBorderEn: 1,
    }),
    isEventCapture: 1,
  });

  if (first) {
    await bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({ containerTotalNum: 1, listObject: [listContainer] }),
    );
  } else {
    await bridge.rebuildPageContainer(
      new RebuildPageContainer({ containerTotalNum: 1, listObject: [listContainer] }),
    );
  }
}

async function renderReading(bridge: EvenAppBridge) {
  glassesState.screen = 'reading';
  const pages = chapterPages[glassesState.chapterIndex];
  const chapter = chapters[glassesState.chapterIndex];
  const pageText = pages[glassesState.pageIndex];

  const heading = `[${chapter.category} ${glassesState.pageIndex + 1}/${pages.length}]\n`;

  const textContainer = new TextContainerProperty({
    xPosition: 8,
    yPosition: 8,
    width: GLASSES_WIDTH - 16,
    height: 200,
    containerID: 2,
    containerName: 'read-text',
    content: (heading + pageText).slice(0, 980),
    isEventCapture: 0,
  });

  const navItems = ['次へ', '前へ', '章一覧へ'];
  const navList = new ListContainerProperty({
    xPosition: 8,
    yPosition: 212,
    width: GLASSES_WIDTH - 16,
    height: 68,
    containerID: 3,
    containerName: 'read-nav',
    itemContainer: new ListItemContainerProperty({
      itemCount: navItems.length,
      itemName: navItems,
      itemWidth: 0,
      isItemSelectBorderEn: 1,
    }),
    isEventCapture: 1,
  });

  await bridge.rebuildPageContainer(
    new RebuildPageContainer({
      containerTotalNum: 2,
      textObject: [textContainer],
      listObject: [navList],
    }),
  );
}

async function handleListEvent(bridge: EvenAppBridge, listEvent: List_ItemEvent) {
  const idx = listEvent.currentSelectItemIndex ?? -1;
  if (idx < 0) return;

  if (glassesState.screen === 'toc') {
    glassesState.chapterIndex = idx;
    glassesState.pageIndex = 0;
    await renderReading(bridge);
    return;
  }

  const pages = chapterPages[glassesState.chapterIndex];
  if (idx === 0) {
    glassesState.pageIndex = (glassesState.pageIndex + 1) % pages.length;
    await renderReading(bridge);
  } else if (idx === 1) {
    glassesState.pageIndex = (glassesState.pageIndex - 1 + pages.length) % pages.length;
    await renderReading(bridge);
  } else {
    await renderToc(bridge, false);
  }
}

async function startGlassesUI(bridge: EvenAppBridge) {
  chapterPages = buildChapterPages();
  await renderToc(bridge, true);
  bridge.onEvenHubEvent((event) => {
    if (event.listEvent) {
      handleListEvent(bridge, event.listEvent);
    }
  });
}

// ---------- Boot ----------

async function tryInitGlasses() {
  const statusEl = document.getElementById('glassesStatus');
  try {
    const bridgePromise = waitForEvenAppBridge();
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000));
    const bridge = await Promise.race([bridgePromise, timeout]);
    if (!bridge) return; // Even App bridge not present (plain browser) — book view only

    bridge.onLaunchSource(async (source) => {
      if (source !== 'glassesMenu') return;
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent = 'EvenG2に表示中 — リング操作でページを送れます';
      }
      await startGlassesUI(bridge);
    });
  } catch (err) {
    console.warn('EvenApp bridge unavailable, showing book view only.', err);
  }
}

function main() {
  renderBook();
  tryInitGlasses();
}

main();
