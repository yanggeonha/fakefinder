const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 정적 파일 서빙
app.use(express.static(path.join(__dirname, 'public')));

// 게임 상태
const gameState = {
    teams: [],
    phase: 'lobby', // lobby, creating, guessing, roundResult, stageResult, final
    currentStage: 1,    // 1, 2, 3 단계
    currentRound: 1,    // 1~5 라운드
    maxStages: 3,
    maxRounds: 5,
    currentCreatorIndex: 0,
    originalBill: null,
    submissions: {},
    roundResults: {},   // 각 팀별 라운드 결과 저장: { odcId: { stage1: [r1%, r2%...], stage2: [...] } }
    timerInterval: null,
    timeLeft: 30,
    gameStarted: false,
    usedElements: [],    // 감별사가 사용한 요소들 (고유 타입)
    totalElementCount: 0 // 감별사가 배치한 총 요소 개수
};

// 빈 지폐 생성 (5x3 = 15칸)
function createEmptyBill() {
    return {
        grid: Array(15).fill(null),
        amount: '10000'
    };
}

// 일치 계산 및 맞은 위치 반환
function calculateMatch(original, submitted) {
    let matches = 0;
    let total = 0;
    const correctPositions = [];

    // 격자 비교 (15칸)
    for (let i = 0; i < 15; i++) {
        if (original.grid[i] !== null) {
            total++;
            if (original.grid[i] === submitted.grid[i]) {
                matches++;
                correctPositions.push(i);
            }
        }
    }

    // 금액 비교
    total++;
    const amountCorrect = original.amount === submitted.amount;
    if (amountCorrect) {
        matches++;
    }

    return { matches, total, correctPositions, amountCorrect };
}

// 감별사가 사용한 요소 추출 (고유한 요소 타입만)
function getUsedElements(bill) {
    const elements = new Set();
    for (let i = 0; i < 15; i++) {
        if (bill.grid[i] !== null) {
            elements.add(bill.grid[i]);
        }
    }
    return Array.from(elements);
}

// 배치된 총 요소 개수
function getTotalElementCount(bill) {
    let count = 0;
    for (let i = 0; i < 15; i++) {
        if (bill.grid[i] !== null) {
            count++;
        }
    }
    return count;
}

// 게임 상태 초기화
function resetGame() {
    gameState.teams = [];
    gameState.phase = 'lobby';
    gameState.currentStage = 1;
    gameState.currentRound = 1;
    gameState.currentCreatorIndex = 0;
    gameState.originalBill = null;
    gameState.submissions = {};
    gameState.roundResults = {};
    gameState.gameStarted = false;
    gameState.usedElements = [];
    gameState.totalElementCount = 0;
    clearInterval(gameState.timerInterval);
}

// 타이머 시작
function startTimer() {
    gameState.timeLeft = 30;
    io.emit('timerUpdate', gameState.timeLeft);

    gameState.timerInterval = setInterval(() => {
        gameState.timeLeft--;
        io.emit('timerUpdate', gameState.timeLeft);

        if (gameState.timeLeft <= 0) {
            clearInterval(gameState.timerInterval);
            // 시간 초과 - 제출 안 한 팀들 빈 제출 처리
            const creator = gameState.teams[gameState.currentCreatorIndex];
            gameState.teams.forEach(team => {
                if (team.role === 'counterfeiter' && !gameState.submissions[team.id]) {
                    gameState.submissions[team.id] = createEmptyBill();
                }
            });
            showRoundResults();
        }
    }, 1000);
}

// 라운드 결과 계산 및 전송
function showRoundResults() {
    clearInterval(gameState.timerInterval);
    gameState.phase = 'roundResult';

    const creator = gameState.teams[gameState.currentCreatorIndex];
    const results = [];

    gameState.teams.forEach(team => {
        if (team.role === 'counterfeiter') {
            const submission = gameState.submissions[team.id] || createEmptyBill();
            const { matches, total, correctPositions, amountCorrect } = calculateMatch(gameState.originalBill, submission);

            // 라운드 결과 저장 (맞힌 갯수/총 갯수)
            if (!gameState.roundResults[team.id]) {
                gameState.roundResults[team.id] = { stage1: [], stage2: [], stage3: [] };
            }
            gameState.roundResults[team.id][`stage${gameState.currentStage}`].push({ matches, total });

            results.push({
                odcId: team.id,
                teamName: team.name,
                matches: matches,
                total: total,
                submission: submission,
                correctPositions: correctPositions,
                amountCorrect: amountCorrect
            });
        }
    });

    io.emit('showRoundResults', {
        stage: gameState.currentStage,
        round: gameState.currentRound,
        creator: creator,
        originalBill: gameState.originalBill,
        results: results,
        roundResults: gameState.roundResults,
        totalElements: gameState.totalElementCount
    });
}

// Socket.io 연결 처리
io.on('connection', (socket) => {
    console.log('새 연결:', socket.id);

    // 현재 게임 상태 전송
    socket.emit('gameState', {
        teams: gameState.teams,
        phase: gameState.phase,
        currentStage: gameState.currentStage,
        currentRound: gameState.currentRound,
        gameStarted: gameState.gameStarted,
        roundResults: gameState.roundResults
    });

    // 팀 입장
    socket.on('joinTeam', (data) => {
        console.log(`입장 시도: ${data.name} (${data.role}) - socket: ${socket.id}`);

        if (gameState.gameStarted) {
            console.log('입장 실패: 게임 이미 시작됨');
            socket.emit('error', '게임이 이미 시작되었습니다!');
            return;
        }

        if (gameState.teams.length >= 10) {
            console.log('입장 실패: 최대 인원 초과');
            socket.emit('error', '최대 10팀까지만 참가할 수 있습니다!');
            return;
        }

        if (gameState.teams.some(t => t.name === data.name)) {
            console.log('입장 실패: 중복된 팀 이름');
            socket.emit('error', '이미 존재하는 팀 이름입니다!');
            return;
        }

        // 이미 입장한 소켓인지 확인
        if (gameState.teams.some(t => t.id === socket.id)) {
            console.log('입장 실패: 이미 입장한 소켓');
            socket.emit('error', '이미 입장했습니다!');
            return;
        }

        // 감별사는 1명만
        if (data.role === 'appraiser' && gameState.teams.some(t => t.role === 'appraiser')) {
            console.log('입장 실패: 감별사가 이미 있음');
            socket.emit('error', '감별사는 1명만 가능합니다!');
            return;
        }

        const team = {
            id: socket.id,
            name: data.name,
            role: data.role  // 'appraiser' (감별사) 또는 'counterfeiter' (위조지폐제작자)
        };

        gameState.teams.push(team);
        gameState.roundResults[team.id] = { stage1: [], stage2: [], stage3: [] };

        socket.team = team;

        // 입장한 본인에게만 성공 알림
        socket.emit('joinSuccess', { team: team });

        // 모든 클라이언트에게 팀 목록 업데이트
        io.emit('teamListUpdated', {
            teams: gameState.teams
        });

        console.log(`팀 입장 성공: ${team.name} (${team.role}) - 현재 ${gameState.teams.length}팀`);
    });

    // 게임 시작
    socket.on('startGame', () => {
        const hasAppraiser = gameState.teams.some(t => t.role === 'appraiser');
        const hasCounterfeiter = gameState.teams.some(t => t.role === 'counterfeiter');

        if (!hasAppraiser) {
            socket.emit('error', '감별사가 필요합니다!');
            return;
        }

        if (!hasCounterfeiter) {
            socket.emit('error', '위조지폐제작자가 최소 1팀 필요합니다!');
            return;
        }

        if (gameState.gameStarted) return;

        gameState.gameStarted = true;
        gameState.phase = 'creating';
        gameState.currentStage = 1;
        gameState.currentRound = 1;

        // 감별사 찾기
        const appraiser = gameState.teams.find(t => t.role === 'appraiser');
        gameState.currentCreatorIndex = gameState.teams.indexOf(appraiser);

        io.emit('gameStarted', {
            phase: 'creating',
            currentStage: gameState.currentStage,
            currentRound: gameState.currentRound,
            creator: appraiser,
            teams: gameState.teams
        });

        console.log('게임 시작!');
    });

    // 위조지폐 제출 (감별사)
    socket.on('submitOriginal', (bill) => {
        if (gameState.phase !== 'creating') return;

        const appraiser = gameState.teams.find(t => t.role === 'appraiser');
        if (socket.id !== appraiser.id) {
            socket.emit('error', '감별사만 지폐를 만들 수 있습니다!');
            return;
        }

        gameState.originalBill = bill;
        gameState.usedElements = getUsedElements(bill);
        gameState.totalElementCount = getTotalElementCount(bill);
        gameState.phase = 'guessing';
        gameState.submissions = {};

        io.emit('guessingPhase', {
            creator: appraiser,
            usedElements: gameState.usedElements,
            elementCount: gameState.usedElements.length,
            totalElementCount: gameState.totalElementCount,
            timeLeft: 30
        });

        startTimer();
        console.log(`감별사가 위조지폐를 제출했습니다. 사용 요소: ${gameState.usedElements.join(', ')}`);
    });

    // 추측 제출 (위조지폐제작자)
    socket.on('submitGuess', (bill) => {
        if (gameState.phase !== 'guessing') return;

        const team = gameState.teams.find(t => t.id === socket.id);
        if (!team || team.role !== 'counterfeiter') {
            socket.emit('error', '위조지폐제작자만 제출할 수 있습니다!');
            return;
        }

        if (gameState.submissions[socket.id]) {
            socket.emit('error', '이미 제출했습니다!');
            return;
        }

        gameState.submissions[socket.id] = bill;

        // 제출 현황 브로드캐스트
        const counterfeiters = gameState.teams.filter(t => t.role === 'counterfeiter');
        const submittedTeams = counterfeiters.filter(t => gameState.submissions[t.id]);

        io.emit('submissionUpdate', {
            submittedCount: submittedTeams.length,
            totalCounterfeiters: counterfeiters.length,
            submittedTeams: submittedTeams.map(t => t.name)
        });

        console.log(`${team.name}이 추측을 제출했습니다.`);

        // 모든 위조지폐제작자가 제출했는지 확인
        const allSubmitted = counterfeiters.every(t => gameState.submissions[t.id]);

        if (allSubmitted) {
            clearInterval(gameState.timerInterval);
            showRoundResults();
        }
    });

    // 다음 라운드
    socket.on('nextRound', () => {
        gameState.currentRound++;

        if (gameState.currentRound > gameState.maxRounds) {
            // 단계 종료
            gameState.currentRound = 1;
            gameState.currentStage++;

            if (gameState.currentStage > gameState.maxStages) {
                // 최종 결과
                gameState.phase = 'final';

                const finalScores = gameState.teams
                    .filter(t => t.role === 'counterfeiter')
                    .map(team => {
                        const results = gameState.roundResults[team.id];
                        const allRounds = [...results.stage1, ...results.stage2, ...results.stage3];

                        // 총 맞힌 갯수와 총 문제 수 계산
                        const totalMatches = allRounds.reduce((sum, r) => sum + r.matches, 0);
                        const totalQuestions = allRounds.reduce((sum, r) => sum + r.total, 0);
                        const perfectRounds = allRounds.filter(r => r.matches === r.total).length;

                        // 단계별 맞힌 갯수 계산
                        const stage1Matches = results.stage1.reduce((sum, r) => sum + r.matches, 0);
                        const stage1Total = results.stage1.reduce((sum, r) => sum + r.total, 0);
                        const stage2Matches = results.stage2.reduce((sum, r) => sum + r.matches, 0);
                        const stage2Total = results.stage2.reduce((sum, r) => sum + r.total, 0);
                        const stage3Matches = results.stage3.reduce((sum, r) => sum + r.matches, 0);
                        const stage3Total = results.stage3.reduce((sum, r) => sum + r.total, 0);

                        return {
                            id: team.id,
                            name: team.name,
                            totalMatches: totalMatches,
                            totalQuestions: totalQuestions,
                            perfectRounds: perfectRounds,
                            roundResults: results,
                            stageResults: {
                                stage1: { matches: stage1Matches, total: stage1Total },
                                stage2: { matches: stage2Matches, total: stage2Total },
                                stage3: { matches: stage3Matches, total: stage3Total }
                            }
                        };
                    })
                    .sort((a, b) => b.totalMatches - a.totalMatches || b.perfectRounds - a.perfectRounds);

                io.emit('finalResults', {
                    scores: finalScores,
                    winner: finalScores[0]
                });
            } else {
                // 다음 단계 시작 대기 (지폐 초기화)
                gameState.phase = 'stageWaiting';
                gameState.originalBill = null;
                gameState.submissions = {};
                gameState.usedElements = [];
                gameState.totalElementCount = 0;

                io.emit('stageComplete', {
                    completedStage: gameState.currentStage - 1,
                    nextStage: gameState.currentStage,
                    roundResults: gameState.roundResults
                });
            }
        } else {
            // 다음 라운드 (같은 단계 내 - 지폐 유지, 바로 guessing 단계로)
            gameState.phase = 'guessing';
            gameState.submissions = {};

            const appraiser = gameState.teams.find(t => t.role === 'appraiser');

            io.emit('newRoundGuessing', {
                phase: 'guessing',
                currentStage: gameState.currentStage,
                currentRound: gameState.currentRound,
                creator: appraiser,
                usedElements: gameState.usedElements,
                totalElementCount: gameState.totalElementCount,
                roundResults: gameState.roundResults
            });

            startTimer();
        }
    });

    // 다음 단계 시작
    socket.on('startNextStage', () => {
        gameState.phase = 'creating';
        gameState.originalBill = null;
        gameState.submissions = {};
        gameState.usedElements = [];
        gameState.totalElementCount = 0;

        const appraiser = gameState.teams.find(t => t.role === 'appraiser');

        io.emit('newRound', {
            phase: 'creating',
            currentStage: gameState.currentStage,
            currentRound: gameState.currentRound,
            creator: appraiser,
            roundResults: gameState.roundResults
        });
    });

    // 게임 재시작
    socket.on('restartGame', () => {
        resetGame();
        io.emit('gameReset');
        console.log('게임이 재시작되었습니다.');
    });

    // 연결 해제
    socket.on('disconnect', () => {
        console.log('연결 해제:', socket.id);

        const index = gameState.teams.findIndex(t => t.id === socket.id);
        if (index !== -1) {
            const team = gameState.teams[index];
            gameState.teams.splice(index, 1);
            delete gameState.roundResults[socket.id];

            io.emit('teamLeft', {
                teams: gameState.teams,
                leftTeam: team
            });

            console.log(`팀 퇴장: ${team.name}`);

            // 감별사가 나갔으면 게임 리셋
            if (team.role === 'appraiser' && gameState.gameStarted) {
                resetGame();
                io.emit('gameReset');
                io.emit('error', '감별사가 나가서 게임이 종료되었습니다.');
            }

            // 위조지폐제작자가 모두 나갔으면 게임 리셋
            const counterfeiters = gameState.teams.filter(t => t.role === 'counterfeiter');
            if (counterfeiters.length === 0 && gameState.gameStarted) {
                resetGame();
                io.emit('gameReset');
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

server.listen(PORT, HOST, () => {
    console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
    console.log(`로컬 접속: http://localhost:${PORT}`);

    const os = require('os');
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                console.log(`다른 기기 접속: http://${iface.address}:${PORT}`);
            }
        }
    }
});
