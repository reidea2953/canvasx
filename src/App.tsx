import { useAppState } from './state/store';
import { Actions } from './ui/Actions';
import { Canvas } from './ui/Canvas';
import { CanvasOptions } from './ui/CanvasOptions';
import { ContextMenu } from './ui/ContextMenu';
import { DevPanel } from './ui/DevPanel';
import { MainMenu } from './ui/MainMenu';
import { PresenceBar } from './ui/PresenceBar';
import { SearchPanel } from './ui/SearchPanel';
import { ShareButton } from './ui/ShareButton';
import { StatsPanel } from './ui/StatsPanel';
import { StylePanel } from './ui/StylePanel';
import { TextEditor } from './ui/TextEditor';
import { Toolbar } from './ui/Toolbar';
import { useGlobalShortcuts } from './ui/useGlobalShortcuts';
import { ZoomControls } from './ui/ZoomControls';

export function App() {
  useGlobalShortcuts();
  const theme = useAppState((state) => state.theme);

  return (
    <div className="app" data-theme={theme}>
      <Canvas />
      <TextEditor />
      <Toolbar />
      <MainMenu />
      <PresenceBar />
      <ShareButton />
      <SearchPanel />
      <div className="left-rail">
        <StylePanel />
        <Actions />
      </div>
      <CanvasOptions />
      <ZoomControls />
      <StatsPanel />
      <ContextMenu />
      {import.meta.env.DEV && <DevPanel />}
    </div>
  );
}
