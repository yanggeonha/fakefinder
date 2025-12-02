// Socket.io 연결
const socket = io();

// 연결 상태 로깅
socket.on('connect', () => {
    console.log('서버에 연결됨:', socket.id);
});

socket.on('disconnect', () => {
    console.log('서버 연결 끊김');
});

socket.on('connect_error', (error) => {
    console.error('연결 오류:', error);
    showToast('서버 연결 오류!');
});

// 클라이언트 상태
const clientState = {
    myTeam: null,
    teams: [],
    isCreator: false,
    hasSubmitted: false,
    selectedElement: null,
    currentBill: createEmptyBill()
};

// 요소 아이콘 매핑
const elementIcons = {
    portrait: '👤',
    logo: '🏛️',
    watermark: '💧',
    serial: '🔢',
    pattern: '🌀',
    stamp: '🔖'
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

    // 금액 표시 업데이트
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
}

// 팀 목록 업데이트
function updateTeamList(teams) {
    clientState.teams = teams;
    const list = document.getElementById('teamList');
    const count = document.getElementById('teamCount');

    count.textContent = teams.length;

    list.innerHTML = teams.map(team => {
        const isMe = clientState.myTeam && team.id === clientState.myTeam.id;
        const roleName = team.role === 'creator' ? '위조지폐 제작자' : '경찰';
        return `
            <li class="${isMe ? 'me' : ''}">
                <span>${team.name} ${isMe ? '(나)' : ''}</span>
                <span class="role ${team.role}">${roleName}</span>
            </li>
        `;
    }).join('');

    // 시작 버튼 상태
    const btn = document.getElementById('startGameBtn');
    const hasEnoughTeams = teams.length >= 2;
    btn.disabled = !hasEnoughTeams;
    btn.textContent = hasEnoughTeams ? '게임 시작!' : '게임 시작 (최소 2팀 필요)';

    console.log('팀 목록 업데이트:', teams.length, '팀');
}

// 팀 입장
function joinTeam(role) {
    const nameInput = document.getElementById('teamNameInput');
    const teamName = nameInput.value.trim();

    if (!teamName) {
        showToast('팀 이름을 입력해주세요!');
        return;
    }

    console.log('팀 입장 시도:', teamName, '역할:', role);
    socket.emit('joinTeam', { name: teamName, role: role });
}

// 게임 시작
function startGame() {
    socket.emit('startGame');
}

// 지폐 격자 생성 (5x3 = 15칸)
function createBillGrid(editable = true) {
    const grid = document.getElementById('billGrid');
    grid.innerHTML = '';

    for (let i = 0; i < 15; i++) {
        const cell = document.createElement('div');
        cell.className = 'grid-cell';
        cell.dataset.index = i;

        if (editable) {
            cell.onclick = () => placeElement(i);
        }

        if (clientState.currentBill.grid[i]) {
            cell.classList.add('filled');
            cell.textContent = elementIcons[clientState.currentBill.grid[i]];
        }

        grid.appendChild(cell);
    }

    // 지폐 편집 가능 여부
    const bill = document.querySelector('.bill');
    if (bill) {
        if (editable) {
            bill.classList.remove('disabled');
        } else {
            bill.classList.add('disabled');
        }
        // 현재 금액으로 색상 설정
        bill.dataset.amount = clientState.currentBill.amount;
    }

    // 금액 표시 업데이트
    const amountDisplay = document.getElementById('amountDisplay');
    if (amountDisplay) {
        amountDisplay.textContent = clientState.currentBill.amount;
    }

    // 금액 선택기 동기화
    const amountSelect = document.getElementById('amountSelect');
    if (amountSelect) {
        amountSelect.value = clientState.currentBill.amount;
    }
}

// 요소 선택
function selectElement(element) {
    clientState.selectedElement = element;

    document.querySelectorAll('.element-btn').forEach(btn => {
        btn.classList.remove('selected');
    });

    document.querySelector(`[data-element="${element}"]`).classList.add('selected');
}

// 요소 배치
function placeElement(index) {
    if (!clientState.selectedElement) {
        showToast('먼저 배치할 요소를 선택해주세요!');
        return;
    }

    if (clientState.currentBill.grid[index] === clientState.selectedElement) {
        clientState.currentBill.grid[index] = null;
    } else {
        clientState.currentBill.grid[index] = clientState.selectedElement;
    }

    createBillGrid(true);
}

// 제출
function submitBill() {
    const amount = document.getElementById('amountSelect').value;
    clientState.currentBill.amount = amount;

    // 최소 1개 요소 체크
    const hasElements = clientState.currentBill.grid.some(cell => cell !== null);
    if (!hasElements) {
        showToast('최소 1개의 요소를 배치해주세요!');
        return;
    }

    if (clientState.isCreator) {
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

// 게임 재시작
function restartGame() {
    socket.emit('restartGame');
}

// 지폐 HTML 생성 (결과용)
function createBillHTML(bill, small = false) {
    const gridHTML = bill.grid.map((cell, i) => `
        <div class="grid-cell ${cell ? 'filled' : ''}" style="${small ? 'font-size: 0.8rem;' : ''}">
            ${cell ? elementIcons[cell] : ''}
        </div>
    `).join('');

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

// 결과 지폐 컨테이너 생성
function createResultBillHTML(bill) {
    const container = document.createElement('div');
    container.className = 'result-bill';
    container.dataset.amount = bill.amount;
    container.innerHTML = createBillHTML(bill);
    return container.outerHTML;
}

// ===== Socket.io 이벤트 핸들러 =====

// 초기 게임 상태 수신
socket.on('gameState', (data) => {
    console.log('게임 상태 수신:', data);
    updateTeamList(data.teams);

    // 새 사용자는 항상 joinSection을 볼 수 있어야 함
    if (!clientState.myTeam) {
        document.getElementById('joinSection').style.display = 'block';
        document.getElementById('joinedSection').style.display = 'none';
    }

    if (data.gameStarted) {
        showToast('게임이 진행 중입니다!');
    }
});

// 에러 처리
socket.on('error', (message) => {
    showToast(message);
});

// 본인 입장 성공 (본인에게만 전송됨)
socket.on('joinSuccess', (data) => {
    console.log('입장 성공:', data.team);
    clientState.myTeam = data.team;
    document.getElementById('joinSection').style.display = 'none';
    document.getElementById('joinedSection').style.display = 'block';
    document.getElementById('myTeamName').textContent = clientState.myTeam.name;
    document.getElementById('myRole').textContent =
        clientState.myTeam.role === 'creator' ? '위조지폐 제작자' : '경찰';
    showToast('입장 완료!');
});

// 팀 목록 업데이트 (모든 클라이언트에게 전송됨)
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
    showScreen('game');
    setupCreatingPhase(data.creator, data.currentRound);
});

// 제작 단계 설정
function setupCreatingPhase(creator, round) {
    clientState.currentBill = createEmptyBill();
    clientState.hasSubmitted = false;
    clientState.isCreator = (clientState.myTeam && clientState.myTeam.id === creator.id);

    document.getElementById('currentRound').textContent = round;
    document.getElementById('phaseText').textContent = '위조지폐 제작 단계';
    document.getElementById('turnInfo').textContent = `${creator.name}의 차례`;
    document.getElementById('timer').textContent = '-';
    document.querySelector('.timer-container').classList.remove('warning');

    if (clientState.isCreator) {
        // 제작자
        document.getElementById('roleInfo').textContent = '당신은 위조지폐 제작자입니다!';
        document.getElementById('roleInfo').className = 'creator';
        document.getElementById('elementPanel').style.display = 'block';
        document.getElementById('waitingMessage').style.display = 'none';
        document.getElementById('submissionStatus').style.display = 'none';
        document.getElementById('submitBtn').style.display = 'inline-block';
        document.getElementById('submitBtn').disabled = false;
        document.getElementById('alreadySubmitted').style.display = 'none';
        createBillGrid(true);
    } else {
        // 경찰 - 대기
        document.getElementById('roleInfo').textContent = '경찰: 제작자가 만드는 중...';
        document.getElementById('roleInfo').className = 'police';
        document.getElementById('elementPanel').style.display = 'none';
        document.getElementById('waitingMessage').style.display = 'block';
        document.getElementById('submissionStatus').style.display = 'none';
        document.getElementById('submitBtn').style.display = 'none';
        document.getElementById('alreadySubmitted').style.display = 'none';
        createBillGrid(false);
    }
}

// 추측 단계 시작
socket.on('guessingPhase', (data) => {
    clientState.currentBill = createEmptyBill();
    clientState.hasSubmitted = false;

    document.getElementById('phaseText').textContent = '위조지폐 찾기 단계';
    document.getElementById('turnInfo').textContent = `${data.creator.name}의 위조지폐를 찾아라!`;

    if (clientState.isCreator) {
        // 제작자는 대기
        document.getElementById('roleInfo').textContent = '제작 완료! 경찰들이 찾는 중...';
        document.getElementById('elementPanel').style.display = 'none';
        document.getElementById('waitingMessage').style.display = 'none';
        document.getElementById('submissionStatus').style.display = 'block';
        document.getElementById('submitBtn').style.display = 'none';
        createBillGrid(false);
    } else {
        // 경찰은 추측
        document.getElementById('roleInfo').textContent = '경찰: 위조지폐를 찾아 제출하세요!';
        document.getElementById('roleInfo').className = 'police';
        document.getElementById('elementPanel').style.display = 'block';
        document.getElementById('waitingMessage').style.display = 'none';
        document.getElementById('submissionStatus').style.display = 'block';
        document.getElementById('submitBtn').style.display = 'inline-block';
        document.getElementById('submitBtn').disabled = false;
        document.getElementById('alreadySubmitted').style.display = 'none';
        createBillGrid(true);
    }

    // 제출 현황 초기화
    document.getElementById('submittedCount').textContent = '0';
    document.getElementById('totalPolice').textContent = clientState.teams.length - 1;
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
    document.getElementById('totalPolice').textContent = data.totalPolice;
    document.getElementById('submittedList').innerHTML =
        data.submittedTeams.map(name => `<li>${name}</li>`).join('');
});

// 결과 표시
socket.on('showResults', (data) => {
    document.getElementById('resultTitle').textContent = `${data.creator.name}의 위조지폐 결과`;

    // 원본 지폐 표시
    const originalDisplay = document.getElementById('originalBillDisplay');
    originalDisplay.innerHTML = createBillHTML(data.originalBill);
    originalDisplay.dataset.amount = data.originalBill.amount;

    // 각 팀 결과 표시
    const resultList = document.getElementById('resultList');
    resultList.innerHTML = '';

    data.results.forEach(result => {
        let rateClass = 'low';
        if (result.matchRate >= 80) rateClass = 'high';
        else if (result.matchRate >= 50) rateClass = 'medium';

        const statusText = result.caught ? `${data.creator.name} 검거!` : '도주 성공...';
        const statusClass = result.caught ? 'caught' : 'escaped';
        const isMe = clientState.myTeam && result.teamId === clientState.myTeam.id;

        const card = document.createElement('div');
        card.className = 'result-card';
        if (isMe) {
            card.style.border = '2px solid #f39c12';
        }

        card.innerHTML = `
            <h4>${result.teamName} ${isMe ? '(나)' : ''}</h4>
            <div class="match-rate ${rateClass}">${result.matchRate}%</div>
            <div class="status ${statusClass}">${statusText}</div>
            <div class="mini-bill">
                <div class="result-bill" data-amount="${result.submission.amount}">
                    ${createBillHTML(result.submission, true)}
                </div>
            </div>
        `;

        resultList.appendChild(card);
    });

    // 버튼 설정
    document.getElementById('nextRoundBtn').style.display = data.isLastRound ? 'none' : 'inline-block';
    document.getElementById('restartBtn').style.display = data.isLastRound ? 'inline-block' : 'none';

    showScreen('result');
});

// 새 라운드
socket.on('newRound', (data) => {
    showScreen('game');
    setupCreatingPhase(data.creator, data.currentRound);
});

// 최종 결과
socket.on('finalResults', (data) => {
    const scoresContainer = document.getElementById('finalScores');
    scoresContainer.innerHTML = '';

    data.scores.forEach((team, index) => {
        const isMe = clientState.myTeam && team.id === clientState.myTeam.id;
        const card = document.createElement('div');
        card.className = 'score-card' + (index === 0 ? ' first' : '');

        card.innerHTML = `
            <div class="rank">${index + 1}위</div>
            <h3>${team.name} ${isMe ? '(나)' : ''}</h3>
            <div class="score">${team.score}점</div>
        `;

        scoresContainer.appendChild(card);
    });

    document.getElementById('winner').textContent = `🏆 우승: ${data.winner.name} 🏆`;

    showScreen('finalResult');
});

// 게임 리셋
socket.on('gameReset', () => {
    clientState.myTeam = null;
    clientState.teams = [];
    clientState.isCreator = false;
    clientState.hasSubmitted = false;
    clientState.currentBill = createEmptyBill();

    document.getElementById('joinSection').style.display = 'block';
    document.getElementById('joinedSection').style.display = 'none';
    document.getElementById('teamNameInput').value = '';

    updateTeamList([]);
    showScreen('lobby');
});

// 초기화
document.addEventListener('DOMContentLoaded', () => {
    createBillGrid(false);
});
