import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, Settings, Users, Volume2, VolumeX, MessageSquare, Heart } from 'lucide-react';
import { useGame } from './game/useGame';
import './index.css';

const SUITS = {
  S: { icon: '♠', color: 'black' },
  H: { icon: '♥', color: 'red' },
  D: { icon: '♦', color: 'red' },
  C: { icon: '♣', color: 'black' }
};

const PlayingCard = ({ rank, suit, isHidden, onClick, style, isPlayable }) => {
  if (isHidden) {
    return (
      <motion.div 
        className="playing-card"
        style={{ 
          background: 'linear-gradient(135deg, #1e1e1e 0%, #3a3a3a 100%)',
          border: '2px solid #555',
          ...style 
        }}
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
      >
        <div className="card-center" style={{ color: '#fff' }}>29</div>
      </motion.div>
    );
  }

  const s = SUITS[suit] || SUITS.S;
  return (
    <motion.div 
      className={`playing-card ${s.color}`}
      onClick={onClick}
      style={{ ...style, cursor: isPlayable ? 'pointer' : 'default', opacity: isPlayable === false ? 0.6 : 1 }}
      initial={{ y: 50, opacity: 0, scale: 0.8 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      whileHover={isPlayable ? { y: -15, scale: 1.05 } : {}}
    >
      <div className="card-top-left">
        <span>{rank}</span>
        <span>{s.icon}</span>
      </div>
      <div className="card-center" style={{ color: s.color === 'red' ? '#ef4444' : '#1c1c1e' }}>
        {s.icon}
      </div>
      <div className="card-bottom-right">
        <span>{rank}</span>
        <span>{s.icon}</span>
      </div>
    </motion.div>
  );
};

const ScoreCard = ({ team, points }) => {
  const absPoints = Math.abs(points || 0);
  const isNegative = points < 0;
  
  // In classic 29, 0 is often just no points, but we'll show a 0 card so the UI is stable.
  const rank = absPoints.toString();
  const suit = isNegative ? 'S' : 'H';
  
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
      <div style={{ fontWeight: 'bold', color: team === 'purple' ? 'var(--primary)' : 'var(--accent)', textTransform: 'uppercase', fontSize: '0.9rem', textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>
        {team}
      </div>
      <PlayingCard 
        rank={rank} 
        suit={suit} 
        isHidden={false} 
        style={{ transform: 'scale(0.8)', margin: 0, boxShadow: '0 4px 12px rgba(0,0,0,0.4)' }} 
      />
    </div>
  );
};

const VideoPlayer = ({ stream, muted }) => {
  const videoRef = useRef(null);
  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);
  return (
      <video 
        ref={videoRef}
        autoPlay 
        playsInline
        muted={muted}
        className="avatar-size"
        style={{ borderRadius: '50%', objectFit: 'cover', background: 'black', border: '2px solid var(--primary)' }} 
      />
  );
};

const PlayerArea = ({ position, name, cards, isTurn, points, rounds, team, voiceActive, isMuted, onMuteToggle, videoStream, isLocal }) => {
  const isTop = position === 'top';
  const isBottom = position === 'bottom';
  const isLeft = position === 'left';
  const isRight = position === 'right';

  const flexDirection = isLeft ? 'row' : (isRight ? 'row-reverse' : 'column');
  
  const infoEl = (
    <div className="player-info" style={{ 
      boxShadow: isTurn ? `0 0 15px ${team === 'purple' ? 'var(--primary)' : 'var(--accent)'}` : 'none',
      border: isTurn ? `1px solid ${team === 'purple' ? 'var(--primary)' : 'var(--accent)'}` : '1px solid rgba(255,255,255,0.1)'
    }}>
      {videoStream ? (
        <VideoPlayer stream={videoStream} muted={isLocal} />
      ) : (
        <div className="player-avatar avatar-size" style={{ background: team === 'purple' ? 'var(--primary)' : 'var(--accent)' }}>
          {name ? name.charAt(0).toUpperCase() : 'P'}
        </div>
      )}
      <div>
        <div style={{ fontWeight: 600 }}>{name}</div>
        {points !== undefined && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Pts: {points}</div>}
      </div>
      {voiceActive && (
        <button onClick={onMuteToggle} style={{ background: 'transparent', border: 'none', color: isMuted ? 'red' : 'white', cursor: 'pointer' }}>
          {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
        </button>
      )}
    </div>
  );

  const handEl = (
    isBottom || isTop ? (
      <div className="hand hand-horizontal" style={{ transform: isTop ? 'scale(0.8)' : 'scale(0.95)', transformOrigin: isTop ? 'top center' : 'bottom center' }}>
        {cards}
      </div>
    ) : (
      <div className="hand hand-vertical" style={{ transform: 'scale(0.8)', transformOrigin: isLeft ? 'left center' : 'right center' }}>
        {cards.map((c, i) => (
           <div className="card-vertical-wrapper" key={i} style={{ zIndex: i }}>
              {c}
           </div>
        ))}
      </div>
    )
  );

  return (
    <div className={`player-area player-${position}`} style={{ flexDirection }}>
      {isBottom ? handEl : infoEl}
      {isBottom ? infoEl : handEl}
    </div>
  );
};

export default function App() {
  const client = useGame();
  const state = client.state;
  
  const [room, setRoom] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [adminPass, setAdminPass] = useState('');
  const [team, setTeam] = useState('purple');
  const [lobbyTab, setLobbyTab] = useState('join');
  const [chatInput, setChatInput] = useState('');

  // Position mapping: 0=bottom(me), 1=left, 2=top, 3=right
  const myIndex = client.myNo >= 0 ? client.myNo : 0;
  
  const getIndexForPos = (pos) => {
    if (pos === 'bottom') return myIndex;
    if (pos === 'left') return (myIndex + 1) % 4;
    if (pos === 'top') return (myIndex + 2) % 4;
    if (pos === 'right') return (myIndex + 3) % 4;
    return 0;
  };

  const getPlayerTeam = (idx) => {
    // 0=green, 1=purple, 2=green, 3=purple
    return idx % 2 === 0 ? 'green' : 'purple';
  };

  const getPlayerName = (idx) => {
    return state.names[idx] || `Player ${idx + 1}`;
  };

  const renderTableCard = (pos) => {
    const idx = getIndexForPos(pos);
    const pid = ['green0', 'purple0', 'green1', 'purple1'][idx];
    
    const cardStr = state.table[pid];
    if (!cardStr) return null;
    
    const rank = cardStr.slice(0, -1);
    const suit = cardStr.slice(-1);
    return <PlayingCard rank={rank} suit={suit} />;
  };

  if (state.phase === 'lobby' || state.phase === 'team' || state.phase === 'resuming') {
    return (
      <div className="app-container" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <motion.div 
          className="glass-panel" 
          style={{ width: '400px', padding: '40px', display: 'flex', flexDirection: 'column', gap: '20px' }}
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
        >
          <h1 style={{ textAlign: 'center', fontSize: '2.5rem', marginBottom: '10px' }}>
            <span style={{ color: 'var(--primary)' }}>29</span> Game
          </h1>
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', marginBottom: '20px' }}>
            Premium Multiplayer Experience
          </p>

          {state.ui.createError && <p style={{ color: 'red', textAlign: 'center' }}>{state.ui.createError}</p>}
          {state.ui.joinError && <p style={{ color: 'red', textAlign: 'center' }}>{state.ui.joinError}</p>}
          {state.ui.loginError && <p style={{ color: 'red', textAlign: 'center' }}>{state.ui.loginError.msg}</p>}

          <div style={{ display: 'flex', gap: '10px', marginBottom: '10px', width: '100%' }}>
            <button 
              className="btn-primary" 
              style={{ flex: 1, background: lobbyTab === 'join' ? 'var(--primary)' : 'rgba(255,255,255,0.1)' }}
              onClick={() => setLobbyTab('join')}
            >Join Room</button>
            <button 
              className="btn-primary" 
              style={{ flex: 1, background: lobbyTab === 'create' ? 'var(--accent)' : 'rgba(255,255,255,0.1)' }}
              onClick={() => setLobbyTab('create')}
            >Create Room</button>
          </div>
          
          <input 
            type="text" 
            placeholder="Username" 
            value={username}
            onChange={e => setUsername(e.target.value)}
            style={{ 
              padding: '12px 16px', borderRadius: '12px', border: '1px solid var(--glass-border)',
              background: 'rgba(0,0,0,0.2)', color: 'white', fontFamily: 'Inter', outline: 'none'
            }}
          />
          <input 
            type="text" 
            placeholder="Room Name" 
            value={room}
            onChange={e => setRoom(e.target.value)}
            style={{ 
              padding: '12px 16px', borderRadius: '12px', border: '1px solid var(--glass-border)',
              background: 'rgba(0,0,0,0.2)', color: 'white', fontFamily: 'Inter', outline: 'none'
            }}
          />
          <input 
            type="password" 
            placeholder={lobbyTab === 'create' ? "Set Room Password" : "Enter Room Password"}
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={{ 
              padding: '12px 16px', borderRadius: '12px', border: '1px solid var(--glass-border)',
              background: 'rgba(0,0,0,0.2)', color: 'white', fontFamily: 'Inter', outline: 'none'
            }}
          />
          
          {lobbyTab === 'create' && (
            <input 
              type="password" 
              placeholder="Master Admin Password" 
              value={adminPass}
              onChange={e => setAdminPass(e.target.value)}
              style={{ 
                padding: '12px 16px', borderRadius: '12px', border: '1px solid var(--glass-border)',
                background: 'rgba(255,0,0,0.1)', color: 'white', fontFamily: 'Inter', outline: 'none'
              }}
            />
          )}

          <select 
            value={team} 
            onChange={e => setTeam(e.target.value)}
            style={{ 
              padding: '12px 16px', borderRadius: '12px', border: '1px solid var(--glass-border)',
              background: 'rgba(0,0,0,0.8)', color: 'white', fontFamily: 'Inter', outline: 'none'
            }}
          >
            <option value="purple">Purple Team</option>
            <option value="green">Green Team</option>
          </select>
          
          <button className="btn-primary" onClick={() => {
            if (lobbyTab === 'create') {
              client.createRoom({ name: room, pass: password, mode: 0, admin: adminPass });
              setTimeout(() => client.joinTeam(username, team), 1000);
            } else {
              client.loginRoom(room + '123', password);
              setTimeout(() => client.joinTeam(username, team), 1000);
            }
          }}>
            {lobbyTab === 'create' ? 'Create & Join' : 'Join Game'}
          </button>
        </motion.div>
      </div>
    );
  }

  const renderHand = (pos) => {
    const idx = getIndexForPos(pos);
    const hand = state.hands[idx] || [];
    
    if (pos === 'bottom') {
      return hand.map((c, i) => {
        const rank = c.slice(0, -1);
        const suit = c.slice(-1);
        const isAllowed = state.my.allowed.includes(c);
        return (
          <PlayingCard 
            key={i} 
            rank={rank} 
            suit={suit} 
            isHidden={false} 
            isPlayable={state.my.active && isAllowed}
            onClick={() => client.selectCard(c)}
            style={{ zIndex: i, transform: state.selected === c ? 'translateY(-20px)' : 'none' }}
          />
        );
      });
    } else {
      // Hidden cards
      return hand.map((c, i) => <PlayingCard key={i} isHidden={true} />);
    }
  };

  const getPlayerPid = (idx) => ['green0', 'purple0', 'green1', 'purple1'][idx];

  return (
    <div className="app-container">
      {/* Toast notifications */}
      <div style={{ position: 'fixed', top: '20px', right: '20px', zIndex: 1000, display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <AnimatePresence>
          {state.toasts.map(t => (
            <motion.div 
              key={t.id}
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="glass-panel"
              style={{ padding: '15px 25px', background: t.kind === 'error' ? 'rgba(255,0,0,0.8)' : 'rgba(0,0,0,0.8)', color: 'white' }}
            >
              <span dangerouslySetInnerHTML={{ __html: t.html }} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Top Bar */}
      <div style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', zIndex: 100 }}>
        <div className="glass-panel" style={{ padding: '10px 20px', display: 'flex', alignItems: 'center', gap: '20px' }}>
          <span style={{ fontWeight: 'bold' }}>Room: {state.room?.name || 'Classic'}</span>
          <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>Purple: {state.rounds[1]} R / {state.points[1]} Pts</span>
          <span style={{ color: 'var(--accent)', fontWeight: 'bold' }}>Green: {state.rounds[0]} R / {state.points[0]} Pts</span>
          <span style={{ color: 'var(--text-muted)' }}>| Bid: {state.bidWinner ? `${state.bids[0] || state.bids[1] || ''}` : 'In Progress'}</span>
          {state.trump.open && (
             <span style={{ color: state.trump.card && SUITS[state.trump.card.slice(-1)]?.color === 'red' ? '#ef4444' : 'var(--text-main)', fontWeight: 'bold' }}>
               Trump: {state.trump.card ? SUITS[state.trump.card.slice(-1)]?.icon : 'Opened'}
             </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button 
            className="glass-panel" 
            onClick={() => client.toggleSound()}
            style={{ width: '45px', height: '45px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', color: 'white', cursor: 'pointer' }}
          >
            {state.soundOn ? <Volume2 size={20} /> : <VolumeX size={20} />}
          </button>
          {state.isHost && (
            <button 
              className="glass-panel" 
              onClick={() => client.hostDeleteCurrentRoom()}
              style={{ padding: '0 20px', display: 'flex', alignItems: 'center', gap: '8px', border: 'none', color: 'white', cursor: 'pointer', background: 'rgba(255,0,0,0.4)' }}
            >
              Delete Room
            </button>
          )}
          <button 
            className="glass-panel" 
            onClick={() => client.setChatOpen(!state.chatOpen)}
            style={{ padding: '0 20px', display: 'flex', alignItems: 'center', gap: '8px', border: 'none', color: 'white', cursor: 'pointer', background: state.chatOpen ? 'var(--accent)' : '' }}
          >
            <MessageSquare size={20} /> Chat {state.unread > 0 && `(${state.unread})`}
          </button>
          <button 
            className="glass-panel" 
            onClick={() => client.toggleVoice()}
            style={{ padding: '0 20px', display: 'flex', alignItems: 'center', gap: '8px', border: 'none', color: 'white', cursor: 'pointer', background: state.voice.active ? 'var(--primary)' : '' }}
          >
            {state.voice.active ? <Mic size={20} /> : <MicOff size={20} />} Video Call
          </button>
        </div>
      </div>

      <div className="table-surface"></div>

      {/* Players */}
      <PlayerArea 
        position="top" 
        name={getPlayerName(getIndexForPos('top'))} 
        team={getPlayerTeam(getIndexForPos('top'))}
        points={state.points[getIndexForPos('top') % 2 === 0 ? 0 : 1]} 
        rounds={state.rounds[getIndexForPos('top') % 2 === 0 ? 0 : 1]}
        cards={renderHand('top')} 
        isTurn={state.turn?.player === getPlayerPid(getIndexForPos('top'))}
        voiceActive={state.voice.active}
        isMuted={state.voice.peers[getPlayerPid(getIndexForPos('top'))]?.muted}
        onMuteToggle={() => client.togglePeerMute(getPlayerPid(getIndexForPos('top')))}
        videoStream={state.voice.peers[getPlayerPid(getIndexForPos('top'))]?.stream}
        isLocal={false}
      />
      <PlayerArea 
        position="left" 
        name={getPlayerName(getIndexForPos('left'))} 
        team={getPlayerTeam(getIndexForPos('left'))}
        points={state.points[getIndexForPos('left') % 2 === 0 ? 0 : 1]} 
        rounds={state.rounds[getIndexForPos('left') % 2 === 0 ? 0 : 1]}
        cards={renderHand('left')} 
        isTurn={state.turn?.player === getPlayerPid(getIndexForPos('left'))}
        voiceActive={state.voice.active}
        isMuted={state.voice.peers[getPlayerPid(getIndexForPos('left'))]?.muted}
        onMuteToggle={() => client.togglePeerMute(getPlayerPid(getIndexForPos('left')))}
        videoStream={state.voice.peers[getPlayerPid(getIndexForPos('left'))]?.stream}
        isLocal={false}
      />
      <PlayerArea 
        position="right" 
        name={getPlayerName(getIndexForPos('right'))} 
        team={getPlayerTeam(getIndexForPos('right'))}
        points={state.points[getIndexForPos('right') % 2 === 0 ? 0 : 1]} 
        rounds={state.rounds[getIndexForPos('right') % 2 === 0 ? 0 : 1]}
        cards={renderHand('right')} 
        isTurn={state.turn?.player === getPlayerPid(getIndexForPos('right'))}
        voiceActive={state.voice.active}
        isMuted={state.voice.peers[getPlayerPid(getIndexForPos('right'))]?.muted}
        onMuteToggle={() => client.togglePeerMute(getPlayerPid(getIndexForPos('right')))}
        videoStream={state.voice.peers[getPlayerPid(getIndexForPos('right'))]?.stream}
        isLocal={false}
      />
      <PlayerArea 
        position="bottom" 
        name={getPlayerName(myIndex) + ' (You)'} 
        team={getPlayerTeam(myIndex)}
        points={state.points[myIndex % 2 === 0 ? 0 : 1]} 
        rounds={state.rounds[myIndex % 2 === 0 ? 0 : 1]}
        cards={renderHand('bottom')} 
        isTurn={state.turn?.player === client.meId}
        voiceActive={state.voice.active}
        isMuted={state.voice.micMuted}
        onMuteToggle={() => client.toggleMic()}
        videoStream={state.voice.active ? state.voice.localStream : null}
        isLocal={true}
      />
      
      {/* Score Cards (Bottom Left & Right) */}
      <div style={{ position: 'absolute', bottom: '20px', left: '20px', zIndex: 20 }}>
        <ScoreCard team="green" points={state.rounds[0]} />
      </div>
      <div style={{ position: 'absolute', bottom: '20px', right: '20px', zIndex: 20 }}>
        <ScoreCard team="purple" points={state.rounds[1]} />
      </div>

      {/* Center Played Cards & Modals */}
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 50, display: 'flex', gap: '20px' }}>
          {/* Table Cards */}
          <div style={{ position: 'absolute', transform: 'translate(-50%, -50%) translateY(-80px)' }}>{renderTableCard('top')}</div>
          <div style={{ position: 'absolute', transform: 'translate(-50%, -50%) translateX(-80px)' }}>{renderTableCard('left')}</div>
          <div style={{ position: 'absolute', transform: 'translate(-50%, -50%) translateX(80px)' }}>{renderTableCard('right')}</div>
          <div style={{ position: 'absolute', transform: 'translate(-50%, -50%) translateY(80px)' }}>{renderTableCard('bottom')}</div>

          {state.bid.open && (
            <motion.div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px', zIndex: 100 }}>
              <h3 style={{ textAlign: 'center' }}>Bidding Phase</h3>
              
              {state.bid.mode === 'raise' && (
                <>
                  <p>Current Bid: {state.bid.current}</p>
                  <input type="range" min={state.bid.min} max={28} value={state.bid.value} onChange={(e) => client.setBidValue(e.target.value)} />
                  <p style={{ textAlign: 'center' }}>Your Bid: {state.bid.value}</p>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button className="btn-primary" onClick={() => client.placeBid()}>Bid {state.bid.value}</button>
                    <button className="btn-primary" style={{ background: '#555' }} onClick={() => client.passBid()}>Pass</button>
                  </div>
                </>
              )}
              {state.bid.mode === 'trump' && (
                <>
                  <p style={{ textAlign: 'center' }}>You won the bid! Select Trump:</p>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button className="btn-primary" style={{ background: 'black', color: 'white' }} onClick={() => client.chooseTrump('S')}>♠</button>
                    <button className="btn-primary" style={{ background: 'red', color: 'white' }} onClick={() => client.chooseTrump('H')}>♥</button>
                    <button className="btn-primary" style={{ background: 'red', color: 'white' }} onClick={() => client.chooseTrump('D')}>♦</button>
                    <button className="btn-primary" style={{ background: 'black', color: 'white' }} onClick={() => client.chooseTrump('C')}>♣</button>
                    <button className="btn-primary" onClick={() => client.chooseTrump('7')}>7th Card</button>
                  </div>
                </>
              )}
              {state.bid.mode === 'double' && (
                <>
                  <p style={{ textAlign: 'center' }}>Do you want to double?</p>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button className="btn-primary" onClick={() => client.chooseDouble(2)}>Double</button>
                    <button className="btn-primary" style={{ background: '#555' }} onClick={() => client.chooseDouble(1)}>Pass</button>
                  </div>
                </>
              )}
              {state.bid.mode === 'redouble' && (
                <>
                  <p style={{ textAlign: 'center' }}>Do you want to redouble?</p>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button className="btn-primary" onClick={() => client.chooseDouble(2)}>Redouble</button>
                    <button className="btn-primary" style={{ background: '#555' }} onClick={() => client.chooseDouble(1)}>Pass</button>
                  </div>
                </>
              )}
              {!state.bid.mode && state.bid.stage !== 'done' && (
                <p style={{ textAlign: 'center' }}>Waiting for other players...</p>
              )}
            </motion.div>
          )}

          {state.my.canOpenTrump && !state.trump.open && (
             <motion.div style={{ position: 'absolute', top: '-150px' }}>
                <button className="btn-primary" style={{ background: 'gold', color: 'black' }} onClick={() => client.openTrump()}>Open Trump</button>
             </motion.div>
          )}

          {state.gameOver && (
            <motion.div 
              className="glass-panel" 
              style={{ padding: '40px', display: 'flex', flexDirection: 'column', gap: '15px', zIndex: 200, background: 'rgba(0,0,0,0.8)' }}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
            >
              <h1 style={{ textAlign: 'center', fontSize: '3rem', color: 'var(--primary)', marginBottom: '10px' }}>Game Over!</h1>
              <p style={{ textAlign: 'center', fontSize: '1.2rem' }}>
                Winner: {state.gameOver.winner === 'purple' ? 'Purple Team' : state.gameOver.winner === 'green' ? 'Green Team' : 'Draw'}
              </p>
              <button className="btn-primary" style={{ marginTop: '20px' }} onClick={() => client.leaveTable()}>
                Back to Lobby
              </button>
            </motion.div>
          )}
      </div>

      {/* Chat UI */}
      {state.chatOpen && (
        <motion.div 
          className="glass-panel"
          style={{ position: 'absolute', right: '20px', bottom: '20px', width: '300px', height: '400px', display: 'flex', flexDirection: 'column', zIndex: 200, padding: '15px' }}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '10px' }}>
             <h3 style={{ margin: 0 }}>Game Chat</h3>
             <button onClick={() => client.setChatOpen(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>✕</button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
            {state.chat.map((msg) => (
              <div key={msg.id} dangerouslySetInnerHTML={{ __html: msg.html }} style={{ fontSize: '0.9rem', background: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '8px' }} />
            ))}
          </div>
          <form onSubmit={(e) => {
            e.preventDefault();
            client.sendChat(chatInput);
            setChatInput('');
          }} style={{ display: 'flex', gap: '10px' }}>
            <input 
              type="text" 
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              placeholder="Type a message..."
              style={{ flex: 1, background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', padding: '8px 12px', borderRadius: '8px', outline: 'none' }}
            />
            <button type="submit" className="btn-primary" style={{ padding: '8px 15px' }}>Send</button>
          </form>
        </motion.div>
      )}
    </div>
  );
}
