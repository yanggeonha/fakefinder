// Socket.io 연결
const socket = io();

// 세션 저장 키
const SESSION_KEY = 'fakefinder_session';

// 연결 상태 로깅
socket.on('connect', () => {
    console.log('서버에 연결됨:', socket.id);

    // 저장된 세션이 있으면 재접속 시도
    const savedSession = localStorage.getItem(SESSION_KEY);
    if (savedSession) {
        try {
            const session = JSON.parse(savedSession);
            console.log('세션 복구 시도:', session.sessionId);
            socket.emit('rejoin', { sessionId: session.sessionId });
        } catch (e) {
            console.error('세션 파싱 오류:', e);
            localStorage.removeItem(SESSION_KEY);
        }
    }
});

socket.on('disconnect', () => {
    console.log('서버 연결 끊김');
    showToast('연결이 끊어졌습니다. 재접속 중...');
});

socket.on('connect_error', (error) => {
    console.error('연결 오류:', error);
    showToast('서버 연결 오류!');
});

// 세션 저장 함수
function saveSession(pinCode, team, sessionId) {
    const session = {
        pinCode: pinCode,
        teamName: team.name,
        role: team.role,
        sessionId: sessionId,
        savedAt: Date.now()
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    console.log('세션 저장됨:', session);
}

// 세션 삭제 함수
function clearSession() {
    localStorage.removeItem(SESSION_KEY);
    console.log('세션 삭제됨');
}

// 클라이언트 상태
const clientState = {
    myTeam: null,
    teams: [],
    isAppraiser: false,
    hasSubmitted: false,
    selectedElement: null,
    currentBill: createEmptyBill(),
    usedElements: [],       // 감별사가 사용한 요소들 (고유 타입)
    totalElementCount: 0,   // 감별사가 배치한 총 요소 개수
    roundResults: {},       // 각 팀 라운드별 결과
    currentStage: 1,
    currentRound: 1,
    pinCode: null           // 현재 방 핀번호
};

// ===== 화면 전환 함수 =====
function showMain() {
    showScreen('main');
}

function showCreateRoom() {
    showScreen('createRoom');
    document.getElementById('hostNameInput').focus();
}

function showJoinRoom() {
    showScreen('joinRoom');
    document.getElementById('pinInput').focus();
}

// 방 생성
function createRoom() {
    const name = document.getElementById('hostNameInput').value.trim();
    if (!name) {
        showToast('이름을 입력해주세요!');
        return;
    }
    socket.emit('createRoom', { name: name });
}

// 방 참가
function joinRoom() {
    const pinCode = document.getElementById('pinInput').value.trim();
    const name = document.getElementById('playerNameInput').value.trim();

    if (!pinCode || pinCode.length !== 6) {
        showToast('6자리 핀번호를 입력해주세요!');
        return;
    }
    if (!name) {
        showToast('닉네임을 입력해주세요!');
        return;
    }

    socket.emit('joinRoom', { pinCode: pinCode, name: name });
}

// 핀번호 복사
function copyPinCode() {
    const pinCode = document.getElementById('roomPinCode').textContent;
    navigator.clipboard.writeText(pinCode).then(() => {
        showToast('핀번호가 복사되었습니다!');
    }).catch(() => {
        showToast('복사 실패');
    });
}

// 요소 아이콘 매핑
const elementIcons = {
    portrait: '👤',
    logo: '🏛️',
    watermark: '💧',
    serial: '🔢',
    pattern: '🌀',
    stamp: '🔖'
};

const elementNames = {
    portrait: '인물',
    logo: '로고',
    watermark: '워터마크',
    serial: '일련번호',
    pattern: '무늬',
    stamp: '도장'
};

// 빈 지폐 생성 (5x3 = 15칸)
function createEmptyBill() {
    return {
        grid: Array(15).fill(null),
        amount: '10000'
    };
}

// 금액 변경
function changeAmount(amount) {
    clientState.currentBill.amount = amount;
    const bill = document.getElementById('billElement');
    if (bill) {
        bill.dataset.amount = amount;
    }

    const amountDisplay = document.getElementById('amountDisplay');
    if (amountDisplay) {
        amountDisplay.textContent = amount;
    }
}

// 토스트 메시지 표시
function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// 화면 전환
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
    updateBottomBar(screenId);
}

// 하단 바 표시/숨김 + 게임 종료 버튼 노출 제어
function updateBottomBar(screenId) {
    const bar = document.getElementById('gameBottomBar');
    const endBtn = document.getElementById('endGameBtn');
    if (!bar) return;

    // 게임 진행 중인 화면들에서만 하단 바 표시 (메인/방생성/방찾기/로비는 제외)
    const inGameScreens = ['game', 'result', 'stageStart', 'finalResult'];
    if (inGameScreens.includes(screenId) && clientState.pinCode) {
        bar.classList.add('show');
        document.body.classList.add('has-bottom-bar');
        document.getElementById('gamePinCode').textContent = clientState.pinCode;
        // 감별사(방장)에게만 종료 버튼 노출
        if (endBtn) {
            endBtn.style.display = clientState.isAppraiser ? 'inline-block' : 'none';
        }
    } else {
        bar.classList.remove('show');
        document.body.classList.remove('has-bottom-bar');
        if (endBtn) endBtn.style.display = 'none';
    }
}

// 게임 종료 (방장/감별사 전용)
function endGame() {
    if (!confirm('정말 게임을 종료할까요?\n모든 참가자가 메인 화면으로 나가게 됩니다.')) return;
    socket.emit('endGame');
}

// 팀 목록 업데이트
function updateTeamList(teams) {
    clientState.teams = teams;
    const list = document.getElementById('teamList');
    const count = document.getElementById('teamCount');

    count.textContent = teams.length;

    list.innerHTML = teams.map(team => {
        const isMe = clientState.myTeam && team.id === clientState.myTeam.id;
        const roleName = team.role === 'appraiser' ? '감별사' : '위조지폐범';
        return `
            <li class="${isMe ? 'me' : ''}">
                <span>${team.name} ${isMe ? '(나)' : ''}</span>
                <span class="role ${team.role}">${roleName}</span>
            </li>
        `;
    }).join('');

    // 시작 버튼 상태 (감별사/방장에게만 보임)
    const btn = document.getElementById('startGameBtn');
    const hasCounterfeiter = teams.some(t => t.role === 'counterfeiter');

    // 감별사(방장)인 경우에만 버튼 표시
    if (clientState.isAppraiser) {
        btn.style.display = 'inline-block';
        btn.disabled = !hasCounterfeiter;
        if (!hasCounterfeiter) {
            btn.textContent = '게임 시작 (위조지폐범 필요)';
        } else {
            btn.textContent = `게임 시작! (${teams.length - 1}명 참가)`;
        }
    } else {
        btn.style.display = 'none';
    }
}


// 게임 시작
function startGame() {
    socket.emit('startGame');
}

// 지폐 격자 생성 (5x3 = 15칸)
function createBillGrid(editable = true, correctPositions = []) {
    const grid = document.getElementById('billGrid');
    grid.innerHTML = '';

    for (let i = 0; i < 15; i++) {
        const cell = document.createElement('div');
        cell.className = 'grid-cell';
        cell.dataset.index = i;

        // 맞은 위치 초록색 테두리
        if (correctPositions.includes(i)) {
            cell.classList.add('correct');
        }

        // 편집 모드일 때만 클릭 이벤트 추가
        if (editable) {
            cell.onclick = () => placeElement(i);
            cell.style.cursor = 'pointer';
        }

        if (clientState.currentBill.grid[i]) {
            cell.classList.add('filled');
            cell.textContent = elementIcons[clientState.currentBill.grid[i]];

            // 배치된 요소는 editable 모드에서 항상 클릭 가능 (제거용)
            if (editable) {
                cell.title = '클릭하면 제거됩니다';
            }
        }

        grid.appendChild(cell);
    }

    const bill = document.querySelector('.bill');
    if (bill) {
        if (editable) {
            bill.classList.remove('disabled');
        } else {
            bill.classList.add('disabled');
        }
        bill.dataset.amount = clientState.currentBill.amount;
    }

    const amountDisplay = document.getElementById('amountDisplay');
    if (amountDisplay) {
        amountDisplay.textContent = clientState.currentBill.amount;
    }

    const amountSelect = document.getElementById('amountSelect');
    if (amountSelect) {
        amountSelect.value = clientState.currentBill.amount;
    }
}

// 요소 패널 업데이트
function updateElementPanel() {
    const panel = document.getElementById('elementPanel');
    const elementsDiv = panel.querySelector('.elements');
    elementsDiv.innerHTML = '';

    const allElements = ['portrait', 'logo', 'watermark', 'serial', 'pattern', 'stamp'];
    // 위조지폐범은 감별사가 사용한 요소만 표시
    const elementsToShow = clientState.isAppraiser ? allElements : clientState.usedElements;

    // 패널 제목 업데이트
    const title = document.getElementById('elementPanelTitle');
    if (title) {
        title.textContent = '배치할 요소 선택 (각 요소는 1개씩만)';
    }

    elementsToShow.forEach(element => {
        const btn = document.createElement('button');
        btn.className = 'element-btn';
        btn.dataset.element = element;
        btn.onclick = () => selectElement(element);

        // 이미 배치된 요소는 비활성화 (감별사, 위조지폐범 모두)
        const isUsed = clientState.currentBill.grid.includes(element);
        if (isUsed) {
            btn.classList.add('used');
            btn.disabled = true;
        }

        btn.innerHTML = `${elementIcons[element]} ${elementNames[element]}`;
        elementsDiv.appendChild(btn);
    });

    // 힌트 텍스트 업데이트
    const hint = panel.querySelector('.hint');
    if (hint) {
        const usedCount = clientState.currentBill.grid.filter(e => e !== null).length;
        if (clientState.isAppraiser) {
            hint.textContent = `요소를 선택한 후 격자를 클릭하세요 (${usedCount}개 배치됨)`;
        } else {
            hint.textContent = `요소를 선택한 후 격자를 클릭하세요 (${usedCount}/${clientState.totalElementCount}개 배치됨)`;
        }
    }
}

// 요소 선택
function selectElement(element) {
    // 이미 배치된 요소는 선택 불가 (감별사, 위조지폐범 모두)
    if (clientState.currentBill.grid.includes(element)) {
        showToast('이미 배치된 요소입니다!');
        return;
    }

    clientState.selectedElement = element;

    document.querySelectorAll('.element-btn').forEach(btn => {
        btn.classList.remove('selected');
    });

    const selectedBtn = document.querySelector(`[data-element="${element}"]`);
    if (selectedBtn && !selectedBtn.disabled) {
        selectedBtn.classList.add('selected');
    }
}

// 요소 배치
function placeElement(index) {
    // 이미 요소가 있는 칸을 클릭하면 바로 제거 (요소 선택 필요 없음)
    if (clientState.currentBill.grid[index] !== null) {
        clientState.currentBill.grid[index] = null;
        createBillGrid(true);
        updateElementPanel();
        return;
    }

    // 요소가 선택되지 않은 상태에서 빈 칸 클릭
    if (!clientState.selectedElement) {
        showToast('먼저 배치할 요소를 선택해주세요!');
        return;
    }

    // 이미 배치된 요소는 다시 배치 불가 (감별사, 위조지폐범 모두)
    if (clientState.currentBill.grid.includes(clientState.selectedElement)) {
        showToast('이미 배치된 요소입니다!');
        clientState.selectedElement = null;
        return;
    }

    // 새 위치에 배치
    clientState.currentBill.grid[index] = clientState.selectedElement;

    clientState.selectedElement = null;
    createBillGrid(true);
    updateElementPanel();
}

// 제출
function submitBill() {
    const amount = document.getElementById('amountSelect').value;
    clientState.currentBill.amount = amount;

    // 최소 1개 요소 체크
    const placedCount = clientState.currentBill.grid.filter(cell => cell !== null).length;
    if (placedCount === 0) {
        showToast('최소 1개의 요소를 배치해주세요!');
        return;
    }

    // 위조지폐제작자는 감별사가 배치한 총 요소 개수만큼 배치해야 함
    if (!clientState.isAppraiser && placedCount !== clientState.totalElementCount) {
        showToast(`${clientState.totalElementCount}개의 요소를 모두 배치해주세요!`);
        return;
    }

    if (clientState.isAppraiser) {
        socket.emit('submitOriginal', clientState.currentBill);
    } else {
        socket.emit('submitGuess', clientState.currentBill);
        clientState.hasSubmitted = true;
        document.getElementById('submitBtn').style.display = 'none';
        document.getElementById('alreadySubmitted').style.display = 'block';
    }
}

// 다음 라운드
function nextRound() {
    socket.emit('nextRound');
}

// 다음 단계
function startNextStage() {
    socket.emit('startNextStage');
}

// 게임 재시작
function restartGame() {
    socket.emit('restartGame');
}

// 라운드 결과 패널 업데이트
function updateRoundResultsPanel(roundResults) {
    const panel = document.getElementById('roundResultsPanel');
    if (!panel) return;

    panel.innerHTML = '<h3>라운드 결과</h3>';

    // 현재 단계 정보
    const stageInfo = document.createElement('div');
    stageInfo.className = 'stage-info';
    stageInfo.textContent = `${clientState.currentStage}단계`;
    panel.appendChild(stageInfo);

    clientState.teams.forEach(team => {
        if (team.role !== 'counterfeiter') return;

        const results = roundResults[team.id];
        if (!results) return;

        const teamDiv = document.createElement('div');
        teamDiv.className = 'team-results';
        if (clientState.myTeam && team.id === clientState.myTeam.id) {
            teamDiv.classList.add('my-team');
        }

        const teamName = document.createElement('div');
        teamName.className = 'team-name';
        teamName.textContent = team.name + (clientState.myTeam && team.id === clientState.myTeam.id ? ' (나)' : '');
        teamDiv.appendChild(teamName);

        // 현재 단계의 라운드 결과만 표시 (맞힌 갯수)
        const currentStageResults = results[`stage${clientState.currentStage}`] || [];
        for (let i = 0; i < 5; i++) {
            const roundDiv = document.createElement('div');
            roundDiv.className = 'round-result';

            if (i < currentStageResults.length) {
                const result = currentStageResults[i];
                roundDiv.textContent = `R${i + 1}: ${result.matches}/${result.total}`;
                if (result.matches === result.total) {
                    roundDiv.classList.add('perfect');
                } else if (result.matches >= result.total * 0.8) {
                    roundDiv.classList.add('high');
                } else if (result.matches >= result.total * 0.5) {
                    roundDiv.classList.add('medium');
                } else {
                    roundDiv.classList.add('low');
                }
            } else {
                roundDiv.textContent = `R${i + 1}: -`;
                roundDiv.classList.add('pending');
            }

            teamDiv.appendChild(roundDiv);
        }

        panel.appendChild(teamDiv);
    });
}

// 지폐 HTML 생성 (결과용)
function createBillHTML(bill, small = false, correctPositions = [], showCorrect = false) {
    const gridHTML = bill.grid.map((cell, i) => {
        const isCorrect = correctPositions.includes(i);
        const correctClass = showCorrect && isCorrect ? 'correct' : '';
        return `
            <div class="grid-cell ${cell ? 'filled' : ''} ${correctClass}" style="${small ? 'font-size: 0.8rem;' : ''}">
                ${cell ? elementIcons[cell] : ''}
            </div>
        `;
    }).join('');

    const amounts = {
        '1000': '1,000원 (이황)',
        '5000': '5,000원 (이이)',
        '10000': '10,000원 (세종대왕)',
        '50000': '50,000원 (신사임당)'
    };

    return `
        <div class="bill-info">
            <span>한국은행</span>
            <span>${amounts[bill.amount] || bill.amount}</span>
        </div>
        <div class="bill-grid">
            ${gridHTML}
        </div>
        <div class="bill-amount">${bill.amount}원</div>
    `;
}

// ===== Socket.io 이벤트 핸들러 =====

// 에러 처리
socket.on('error', (message) => {
    showToast(message);
});

// 방 생성 성공 (감별사/방장)
socket.on('roomCreated', (data) => {
    console.log('방 생성 성공:', data);
    clientState.pinCode = data.pinCode;
    clientState.myTeam = data.team;
    clientState.isAppraiser = true;

    // 세션 저장
    saveSession(data.pinCode, data.team, data.sessionId);

    document.getElementById('roomPinCode').textContent = data.pinCode;
    document.getElementById('myTeamName').textContent = data.team.name;
    document.getElementById('myRole').textContent = '감별사 (방장)';

    updateTeamList([data.team]);
    showScreen('lobby');
    showToast(`방이 생성되었습니다! 핀번호: ${data.pinCode}`);
});

// 방 입장 성공 (위조지폐범)
socket.on('joinSuccess', (data) => {
    console.log('입장 성공:', data);
    clientState.pinCode = data.pinCode;
    clientState.myTeam = data.team;
    clientState.isAppraiser = false;

    // 세션 저장
    saveSession(data.pinCode, data.team, data.sessionId);

    document.getElementById('roomPinCode').textContent = data.pinCode;
    document.getElementById('myTeamName').textContent = data.team.name;
    document.getElementById('myRole').textContent = '위조지폐범';

    showScreen('lobby');
    showToast('입장 완료!');
});

// 방이 닫힘 (방장 퇴장)
socket.on('roomClosed', (message) => {
    showToast(message);
    clearSession();
    resetClientState();
    showScreen('main');
});

// 재접속 성공
socket.on('rejoinSuccess', (data) => {
    console.log('재접속 성공:', data);

    clientState.pinCode = data.pinCode;
    clientState.myTeam = data.team;
    clientState.isAppraiser = data.team.role === 'appraiser';
    clientState.teams = data.gameState.teams;
    clientState.currentStage = data.gameState.currentStage;
    clientState.currentRound = data.gameState.currentRound;
    clientState.roundResults = data.gameState.roundResults;
    clientState.usedElements = data.gameState.usedElements || [];
    clientState.totalElementCount = data.gameState.totalElementCount || 0;
    clientState.hasSubmitted = data.gameState.hasSubmitted;

    // 세션 다시 저장 (갱신)
    saveSession(data.pinCode, data.team, data.sessionId);

    document.getElementById('roomPinCode').textContent = data.pinCode;
    document.getElementById('myTeamName').textContent = data.team.name;
    document.getElementById('myRole').textContent = data.team.role === 'appraiser' ? '감별사 (방장)' : '위조지폐범';

    showToast('재접속 성공!');

    // 현재 게임 상태에 따라 화면 복원
    restoreGameState(data.gameState);
});

// 재접속 실패
socket.on('rejoinFailed', (message) => {
    console.log('재접속 실패:', message);
    clearSession();
    showScreen('main');
});

// 게임 상태 복원 함수
function restoreGameState(gameState) {
    const phase = gameState.phase;

    switch (phase) {
        case 'lobby':
            updateTeamList(gameState.teams);
            showScreen('lobby');
            break;

        case 'creating':
            showScreen('game');
            const appraiser = gameState.teams.find(t => t.role === 'appraiser');
            setupCreatingPhase(appraiser, gameState.currentStage, gameState.currentRound);
            break;

        case 'guessing':
            showScreen('game');
            restoreGuessingPhase(gameState);
            break;

        case 'roundResult':
            // 결과 화면은 다음 라운드 시작 대기
            showScreen('result');
            document.getElementById('resultTitle').textContent =
                `${gameState.currentStage}단계 ${gameState.currentRound}라운드 결과`;
            if (clientState.isAppraiser) {
                document.getElementById('nextRoundBtn').style.display = 'inline-block';
                document.getElementById('waitingNextRoundMsg').style.display = 'none';
            } else {
                document.getElementById('nextRoundBtn').style.display = 'none';
                document.getElementById('waitingNextRoundMsg').style.display = 'block';
            }
            break;

        case 'stageWaiting':
            showScreen('stageStart');
            document.getElementById('stageStartTitle').textContent = `${gameState.currentStage - 1}단계 완료!`;
            document.getElementById('stageStartSubtitle').textContent = `${gameState.currentStage}단계를 시작할 준비가 되었습니다.`;
            if (clientState.isAppraiser) {
                document.getElementById('startNextStageBtn').style.display = 'inline-block';
                document.getElementById('waitingForAppraiserMsg').style.display = 'none';
            } else {
                document.getElementById('startNextStageBtn').style.display = 'none';
                document.getElementById('waitingForAppraiserMsg').style.display = 'block';
            }
            break;

        case 'final':
            showScreen('finalResult');
            break;

        default:
            updateTeamList(gameState.teams);
            showScreen('lobby');
    }
}

// 추측 단계 복원
function restoreGuessingPhase(gameState) {
    clientState.currentBill = createEmptyBill();
    clientState.selectedElement = null;
    clientState.usedElements = gameState.usedElements;
    clientState.totalElementCount = gameState.totalElementCount;

    document.getElementById('currentStage').textContent = gameState.currentStage;
    document.getElementById('currentRound').textContent = gameState.currentRound;
    document.getElementById('phaseText').textContent = '위조지폐 찾기 단계';
    document.getElementById('turnInfo').textContent = `감별사의 위조지폐를 맞춰라! (${gameState.totalElementCount}개 요소)`;
    document.getElementById('timer').textContent = gameState.timeLeft || '-';

    if (clientState.isAppraiser) {
        document.getElementById('roleInfo').textContent = '위조지폐범들이 맞추는 중...';
        document.getElementById('roleInfo').className = 'appraiser';
        document.getElementById('elementPanel').style.display = 'none';
        document.getElementById('waitingMessage').style.display = 'none';
        document.getElementById('submissionStatus').style.display = 'block';
        document.getElementById('submitBtn').style.display = 'none';
        createBillGrid(false);
    } else {
        document.getElementById('roleInfo').textContent = `위조지폐범: ${gameState.totalElementCount}개 요소의 위치를 맞추세요!`;
        document.getElementById('roleInfo').className = 'counterfeiter';

        if (gameState.hasSubmitted) {
            document.getElementById('elementPanel').style.display = 'none';
            document.getElementById('submitBtn').style.display = 'none';
            document.getElementById('alreadySubmitted').style.display = 'block';
            createBillGrid(false);
        } else {
            document.getElementById('elementPanel').style.display = 'block';
            document.getElementById('submitBtn').style.display = 'inline-block';
            document.getElementById('alreadySubmitted').style.display = 'none';
            updateElementPanel();
            createBillGrid(true);
        }

        document.getElementById('waitingMessage').style.display = 'none';
        document.getElementById('submissionStatus').style.display = 'block';
    }

    updateRoundResultsPanel(gameState.roundResults);
}

// 클라이언트 상태 초기화
function resetClientState() {
    clientState.myTeam = null;
    clientState.teams = [];
    clientState.isAppraiser = false;
    clientState.hasSubmitted = false;
    clientState.currentBill = createEmptyBill();
    clientState.usedElements = [];
    clientState.totalElementCount = 0;
    clientState.roundResults = {};
    clientState.currentStage = 1;
    clientState.currentRound = 1;
    clientState.pinCode = null;
}

// 팀 목록 업데이트
socket.on('teamListUpdated', (data) => {
    updateTeamList(data.teams);
});

// 팀 퇴장
socket.on('teamLeft', (data) => {
    updateTeamList(data.teams);
    showToast(`${data.leftTeam.name} 팀이 나갔습니다.`);
});

// 게임 시작
socket.on('gameStarted', (data) => {
    clientState.currentStage = data.currentStage;
    clientState.currentRound = data.currentRound;
    clientState.teams = data.teams;
    showScreen('game');
    setupCreatingPhase(data.creator, data.currentStage, data.currentRound);
});

// 제작 단계 설정
function setupCreatingPhase(creator, stage, round) {
    clientState.currentBill = createEmptyBill();
    clientState.hasSubmitted = false;
    clientState.selectedElement = null;
    clientState.isAppraiser = (clientState.myTeam && clientState.myTeam.role === 'appraiser');
    clientState.currentStage = stage;
    clientState.currentRound = round;

    document.getElementById('currentStage').textContent = stage;
    document.getElementById('currentRound').textContent = round;
    document.getElementById('phaseText').textContent = '위조지폐 제작 단계';
    document.getElementById('turnInfo').textContent = `${creator.name}(감별사)의 차례`;
    document.getElementById('timer').textContent = '-';
    document.querySelector('.timer-container').classList.remove('warning');

    if (clientState.isAppraiser) {
        // 감별사 - 지폐 제작
        document.getElementById('roleInfo').textContent = '당신은 감별사입니다! 위조지폐를 만드세요.';
        document.getElementById('roleInfo').className = 'appraiser';
        document.getElementById('elementPanel').style.display = 'block';
        document.getElementById('waitingMessage').style.display = 'none';
        document.getElementById('submissionStatus').style.display = 'none';
        document.getElementById('submitBtn').style.display = 'inline-block';
        document.getElementById('submitBtn').disabled = false;
        document.getElementById('alreadySubmitted').style.display = 'none';
        updateElementPanel(); // 요소 패널 업데이트
        createBillGrid(true);
    } else {
        // 위조지폐범 - 대기
        document.getElementById('roleInfo').textContent = '위조지폐범: 감별사가 만드는 중...';
        document.getElementById('roleInfo').className = 'counterfeiter';
        document.getElementById('elementPanel').style.display = 'none';
        document.getElementById('waitingMessage').style.display = 'block';
        document.getElementById('submissionStatus').style.display = 'none';
        document.getElementById('submitBtn').style.display = 'none';
        document.getElementById('alreadySubmitted').style.display = 'none';
        createBillGrid(false);
    }

    // 라운드 결과 패널 업데이트
    updateRoundResultsPanel(clientState.roundResults);
}

// 추측 단계 시작
socket.on('guessingPhase', (data) => {
    clientState.currentBill = createEmptyBill();
    clientState.hasSubmitted = false;
    clientState.selectedElement = null;
    clientState.usedElements = data.usedElements;
    clientState.totalElementCount = data.totalElementCount;

    document.getElementById('phaseText').textContent = '위조지폐 찾기 단계';
    document.getElementById('turnInfo').textContent = `감별사의 위조지폐를 맞춰라! (${data.totalElementCount}개 요소)`;

    if (clientState.isAppraiser) {
        // 감별사는 대기
        document.getElementById('roleInfo').textContent = '제작 완료! 위조지폐범들이 맞추는 중...';
        document.getElementById('elementPanel').style.display = 'none';
        document.getElementById('waitingMessage').style.display = 'none';
        document.getElementById('submissionStatus').style.display = 'block';
        document.getElementById('submitBtn').style.display = 'none';
        createBillGrid(false);
    } else {
        // 위조지폐범은 추측
        document.getElementById('roleInfo').textContent = `위조지폐범: ${data.totalElementCount}개 요소의 위치를 맞추세요!`;
        document.getElementById('roleInfo').className = 'counterfeiter';
        document.getElementById('elementPanel').style.display = 'block';
        document.getElementById('waitingMessage').style.display = 'none';
        document.getElementById('submissionStatus').style.display = 'block';
        document.getElementById('submitBtn').style.display = 'inline-block';
        document.getElementById('submitBtn').disabled = false;
        document.getElementById('alreadySubmitted').style.display = 'none';
        updateElementPanel(); // 감별사가 사용한 요소만
        createBillGrid(true);
    }

    // 제출 현황 초기화
    const counterfeiters = clientState.teams.filter(t => t.role === 'counterfeiter');
    document.getElementById('submittedCount').textContent = '0';
    document.getElementById('totalCounterfeiters').textContent = counterfeiters.length;
    document.getElementById('submittedList').innerHTML = '';
});

// 타이머 업데이트
socket.on('timerUpdate', (timeLeft) => {
    document.getElementById('timer').textContent = timeLeft;

    const timerContainer = document.querySelector('.timer-container');
    if (timeLeft <= 10) {
        timerContainer.classList.add('warning');
    } else {
        timerContainer.classList.remove('warning');
    }
});

// 제출 현황 업데이트
socket.on('submissionUpdate', (data) => {
    document.getElementById('submittedCount').textContent = data.submittedCount;
    document.getElementById('totalCounterfeiters').textContent = data.totalCounterfeiters;
    document.getElementById('submittedList').innerHTML =
        data.submittedTeams.map(name => `<li>${name}</li>`).join('');
});

// 라운드 결과 표시
socket.on('showRoundResults', (data) => {
    clientState.roundResults = data.roundResults;
    clientState.currentStage = data.stage;

    document.getElementById('resultTitle').textContent =
        `${data.stage}단계 ${data.round}라운드 결과`;

    // 원본 지폐 표시 (감별사에게만 보임)
    const originalBillContainer = document.getElementById('originalBill');
    const originalDisplay = document.getElementById('originalBillDisplay');

    if (clientState.isAppraiser) {
        originalBillContainer.style.display = 'block';
        originalDisplay.innerHTML = createBillHTML(data.originalBill);
        originalDisplay.dataset.amount = data.originalBill.amount;
    } else {
        originalBillContainer.style.display = 'none';
    }

    // 각 팀 결과 표시
    const resultList = document.getElementById('resultList');
    resultList.innerHTML = '';

    data.results.forEach(result => {
        // 맞힌 갯수 기반으로 스타일 결정
        let rateClass = 'low';
        if (result.matches === result.total) rateClass = 'perfect';
        else if (result.matches >= result.total * 0.8) rateClass = 'high';
        else if (result.matches >= result.total * 0.5) rateClass = 'medium';

        const isMe = clientState.myTeam && result.odcId === clientState.myTeam.id;

        const card = document.createElement('div');
        card.className = 'result-card';
        if (isMe) {
            card.style.border = '2px solid #f39c12';
        }

        // 감별사에게는 모든 팀 지폐 표시, 위조지폐범에게는 자신의 지폐만 맞힌 위치와 함께 표시
        if (clientState.isAppraiser) {
            card.innerHTML = `
                <h4>${result.teamName} ${isMe ? '(나)' : ''}</h4>
                <div class="match-count ${rateClass}">${result.matches}/${result.total} 맞힘</div>
                <div class="mini-bill">
                    <div class="result-bill" data-amount="${result.submission.amount}">
                        ${createBillHTML(result.submission, true, result.correctPositions, true)}
                    </div>
                </div>
            `;
        } else if (isMe) {
            // 위조지폐범 본인: 자신이 제출한 지폐에서 맞힌 위치 표시
            card.innerHTML = `
                <h4>${result.teamName} (나)</h4>
                <div class="match-count ${rateClass}">${result.matches}/${result.total} 맞힘</div>
                <div class="mini-bill">
                    <div class="result-bill" data-amount="${result.submission.amount}">
                        ${createBillHTML(result.submission, true, result.correctPositions, true)}
                    </div>
                </div>
            `;
        } else {
            // 다른 위조지폐범: 맞힌 갯수만 표시
            card.innerHTML = `
                <h4>${result.teamName}</h4>
                <div class="match-count ${rateClass}">${result.matches}/${result.total} 맞힘</div>
            `;
        }

        resultList.appendChild(card);
    });

    // 버튼 설정 (감별사에게만 보임)
    const isLastRound = data.round >= 5;
    const isLastStage = data.stage >= 3;

    const nextRoundBtn = document.getElementById('nextRoundBtn');

    // 감별사인 경우에만 버튼 표시
    if (clientState.isAppraiser) {
        nextRoundBtn.style.display = 'inline-block';
        document.getElementById('waitingNextRoundMsg').style.display = 'none';

        if (isLastRound && isLastStage) {
            nextRoundBtn.textContent = '최종 결과 보기';
        } else if (isLastRound) {
            nextRoundBtn.textContent = `${data.stage + 1}단계 시작`;
        } else {
            nextRoundBtn.textContent = '다음 라운드';
        }
    } else {
        nextRoundBtn.style.display = 'none';
        document.getElementById('waitingNextRoundMsg').style.display = 'block';
    }

    document.getElementById('restartBtn').style.display = 'none';

    showScreen('result');
});

// 단계 완료 - 다음 단계 시작 대기 화면 표시
socket.on('stageComplete', (data) => {
    clientState.roundResults = data.roundResults;
    clientState.currentStage = data.nextStage;
    clientState.currentRound = 1;

    // 단계 시작 화면 표시
    document.getElementById('stageStartTitle').textContent = `${data.completedStage}단계 완료!`;
    document.getElementById('stageStartSubtitle').textContent = `${data.nextStage}단계를 시작할 준비가 되었습니다.`;
    document.getElementById('startNextStageBtn').textContent = `${data.nextStage}단계 시작`;

    // 감별사에게만 버튼 표시
    if (clientState.isAppraiser) {
        document.getElementById('startNextStageBtn').style.display = 'inline-block';
        document.getElementById('waitingForAppraiserMsg').style.display = 'none';
    } else {
        document.getElementById('startNextStageBtn').style.display = 'none';
        document.getElementById('waitingForAppraiserMsg').style.display = 'block';
    }

    showScreen('stageStart');
});

// 새 라운드 (단계 첫 라운드 - 지폐 제작 단계)
socket.on('newRound', (data) => {
    clientState.roundResults = data.roundResults || clientState.roundResults;
    showScreen('game');
    setupCreatingPhase(data.creator, data.currentStage, data.currentRound);
});

// 새 라운드 (같은 단계 내 - 바로 추측 단계)
socket.on('newRoundGuessing', (data) => {
    clientState.roundResults = data.roundResults || clientState.roundResults;
    clientState.currentStage = data.currentStage;
    clientState.currentRound = data.currentRound;
    clientState.usedElements = data.usedElements;
    clientState.totalElementCount = data.totalElementCount;
    clientState.currentBill = createEmptyBill();
    clientState.hasSubmitted = false;
    clientState.selectedElement = null;
    clientState.isAppraiser = (clientState.myTeam && clientState.myTeam.role === 'appraiser');

    showScreen('game');

    document.getElementById('currentStage').textContent = data.currentStage;
    document.getElementById('currentRound').textContent = data.currentRound;
    document.getElementById('phaseText').textContent = '위조지폐 찾기 단계';
    document.getElementById('turnInfo').textContent = `감별사의 위조지폐를 맞춰라! (${data.totalElementCount}개 요소)`;
    document.getElementById('timer').textContent = '-';
    document.querySelector('.timer-container').classList.remove('warning');

    if (clientState.isAppraiser) {
        // 감별사는 대기
        document.getElementById('roleInfo').textContent = '위조지폐범들이 맞추는 중...';
        document.getElementById('roleInfo').className = 'appraiser';
        document.getElementById('elementPanel').style.display = 'none';
        document.getElementById('waitingMessage').style.display = 'none';
        document.getElementById('submissionStatus').style.display = 'block';
        document.getElementById('submitBtn').style.display = 'none';
        createBillGrid(false);
    } else {
        // 위조지폐범은 추측
        document.getElementById('roleInfo').textContent = `위조지폐범: ${data.totalElementCount}개 요소의 위치를 맞추세요!`;
        document.getElementById('roleInfo').className = 'counterfeiter';
        document.getElementById('elementPanel').style.display = 'block';
        document.getElementById('waitingMessage').style.display = 'none';
        document.getElementById('submissionStatus').style.display = 'block';
        document.getElementById('submitBtn').style.display = 'inline-block';
        document.getElementById('submitBtn').disabled = false;
        document.getElementById('alreadySubmitted').style.display = 'none';
        updateElementPanel();
        createBillGrid(true);
    }

    // 제출 현황 초기화
    const counterfeiters = clientState.teams.filter(t => t.role === 'counterfeiter');
    document.getElementById('submittedCount').textContent = '0';
    document.getElementById('totalCounterfeiters').textContent = counterfeiters.length;
    document.getElementById('submittedList').innerHTML = '';

    // 라운드 결과 패널 업데이트
    updateRoundResultsPanel(clientState.roundResults);
});

// 최종 결과
socket.on('finalResults', (data) => {
    const scoresContainer = document.getElementById('finalScores');
    scoresContainer.innerHTML = '';

    data.scores.forEach((team, index) => {
        const isMe = clientState.myTeam && team.id === clientState.myTeam.id;
        const card = document.createElement('div');
        card.className = 'score-card' + (index === 0 ? ' first' : '');

        // 메달 이모지
        let medal = '';
        if (index === 0) medal = '🥇 ';
        else if (index === 1) medal = '🥈 ';
        else if (index === 2) medal = '🥉 ';

        // 단계별 맞힌 갯수 표시
        const stage1 = team.stageResults ? team.stageResults.stage1 : { matches: 0, total: 0 };
        const stage2 = team.stageResults ? team.stageResults.stage2 : { matches: 0, total: 0 };
        const stage3 = team.stageResults ? team.stageResults.stage3 : { matches: 0, total: 0 };

        card.innerHTML = `
            <div class="rank">${medal}${index + 1}위</div>
            <h3>${team.name} ${isMe ? '(나)' : ''}</h3>
            <div class="score">총 맞힌 갯수: <strong>${team.totalMatches}/${team.totalQuestions}</strong></div>
            <div class="perfect-count">완벽 라운드: ${team.perfectRounds}/15</div>
            <div class="stage-breakdown">
                <div class="stage-result">1단계: ${stage1.matches}/${stage1.total} 맞힘</div>
                <div class="stage-result">2단계: ${stage2.matches}/${stage2.total} 맞힘</div>
                <div class="stage-result">3단계: ${stage3.matches}/${stage3.total} 맞힘</div>
            </div>
        `;

        scoresContainer.appendChild(card);
    });

    document.getElementById('winner').textContent = `우승: ${data.winner.name}`;

    showScreen('finalResult');
});

// 게임 리셋
socket.on('gameReset', (data) => {
    clientState.hasSubmitted = false;
    clientState.currentBill = createEmptyBill();
    clientState.usedElements = [];
    clientState.totalElementCount = 0;
    clientState.roundResults = {};
    clientState.currentStage = 1;
    clientState.currentRound = 1;

    // 위조지폐범은 세션 삭제 (방에서 나간 것)
    if (!clientState.isAppraiser) {
        clearSession();
        resetClientState();
        showScreen('main');
        showToast('게임이 리셋되었습니다.');
        return;
    }

    // 팀 목록 업데이트 (감별사만 남아있음)
    if (data && data.teams) {
        updateTeamList(data.teams);
    }

    showScreen('lobby');
});

// 초기화
document.addEventListener('DOMContentLoaded', () => {
    createBillGrid(false);
});
