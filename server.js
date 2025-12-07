const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 정적 파일 서빙
app.use(express.static(path.join(__dirname, 'public')));

// 방(Room) 관리
const rooms = {}; // { pinCode: gameState }

// 6자리 핀번호 생성
function generatePinCode() {
    let pin;
    do {
        pin = Math.floor(100000 + Math.random() * 900000).toString();
    } while (rooms[pin]); // 중복 방지
    return pin;
}

// 새 게임 상태 생성
function createGameState() {
    return {
        teams: [],
        phase: 'lobby', // lobby, creating, guessing, roundResult, stageResult, final
        currentStage: 1,    // 1, 2, 3 단계
        currentRound: 1,    // 1~5 라운드
        maxStages: 3,
        maxRounds: 5,
        currentCreatorIndex: 0,
        originalBill: null,
        submissions: {},
        roundResults: {},   // 각 팀별 라운드 결과 저장
        timerInterval: null,
        timeLeft: 30,
        gameStarted: false,
        usedElements: [],    // 감별사가 사용한 요소들 (고유 타입)
        totalElementCount: 0, // 감별사가 배치한 총 요소 개수
        hostId: null         // 방장(감별사) 소켓 ID
    };
}

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

// 게임 상태 초기화 (특정 방)
function resetGame(gameState) {
    gameState.teams = gameState.teams.filter(t => t.role === 'appraiser'); // 감별사(방장)만 유지
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

    // 감별사의 roundResults 초기화
    gameState.teams.forEach(team => {
        gameState.roundResults[team.id] = { stage1: [], stage2: [], stage3: [] };
    });
}

// 타이머 시작 (특정 방)
function startTimer(pinCode) {
    const gameState = rooms[pinCode];
    if (!gameState) return;

    gameState.timeLeft = 30;
    io.to(pinCode).emit('timerUpdate', gameState.timeLeft);

    gameState.timerInterval = setInterval(() => {
        gameState.timeLeft--;
        io.to(pinCode).emit('timerUpdate', gameState.timeLeft);

        if (gameState.timeLeft <= 0) {
            clearInterval(gameState.timerInterval);
            // 시간 초과 - 제출 안 한 팀들 빈 제출 처리
            gameState.teams.forEach(team => {
                if (team.role === 'counterfeiter' && !gameState.submissions[team.id]) {
                    gameState.submissions[team.id] = createEmptyBill();
                }
            });
            showRoundResults(pinCode);
        }
    }, 1000);
}

// 라운드 결과 계산 및 전송 (특정 방)
function showRoundResults(pinCode) {
    const gameState = rooms[pinCode];
    if (!gameState) return;

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

    io.to(pinCode).emit('showRoundResults', {
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

    // 방 생성 (감별사/방장)
    socket.on('createRoom', (data) => {
        const pinCode = generatePinCode();
        const gameState = createGameState();

        // 방장을 감별사로 설정
        const team = {
            id: socket.id,
            name: data.name || '감별사',
            role: 'appraiser'
        };

        gameState.teams.push(team);
        gameState.roundResults[team.id] = { stage1: [], stage2: [], stage3: [] };
        gameState.hostId = socket.id;

        rooms[pinCode] = gameState;

        socket.join(pinCode);
        socket.pinCode = pinCode;
        socket.team = team;

        socket.emit('roomCreated', {
            pinCode: pinCode,
            team: team
        });

        console.log(`방 생성: ${pinCode}, 방장: ${team.name}`);
    });

    // 방 찾기 (핀번호로 입장)
    socket.on('joinRoom', (data) => {
        const pinCode = data.pinCode;
        const gameState = rooms[pinCode];

        if (!gameState) {
            socket.emit('error', '존재하지 않는 방입니다!');
            return;
        }

        if (gameState.gameStarted) {
            socket.emit('error', '게임이 이미 시작되었습니다!');
            return;
        }

        if (gameState.teams.length >= 30) {
            socket.emit('error', '방이 가득 찼습니다! (최대 30팀)');
            return;
        }

        if (gameState.teams.some(t => t.name === data.name)) {
            socket.emit('error', '이미 존재하는 닉네임입니다!');
            return;
        }

        // 위조지폐범으로 입장
        const team = {
            id: socket.id,
            name: data.name,
            role: 'counterfeiter'
        };

        gameState.teams.push(team);
        gameState.roundResults[team.id] = { stage1: [], stage2: [], stage3: [] };

        socket.join(pinCode);
        socket.pinCode = pinCode;
        socket.team = team;

        socket.emit('joinSuccess', {
            pinCode: pinCode,
            team: team
        });

        // 같은 방 모든 클라이언트에게 팀 목록 업데이트
        io.to(pinCode).emit('teamListUpdated', {
            teams: gameState.teams
        });

        console.log(`방 입장: ${pinCode}, ${team.name} (위조지폐범) - 현재 ${gameState.teams.length}팀`);
    });

    // 게임 시작
    socket.on('startGame', () => {
        const pinCode = socket.pinCode;
        const gameState = rooms[pinCode];

        if (!gameState) {
            socket.emit('error', '방을 찾을 수 없습니다!');
            return;
        }

        // 방장만 게임 시작 가능
        if (socket.id !== gameState.hostId) {
            socket.emit('error', '방장만 게임을 시작할 수 있습니다!');
            return;
        }

        const hasCounterfeiter = gameState.teams.some(t => t.role === 'counterfeiter');

        if (!hasCounterfeiter) {
            socket.emit('error', '위조지폐범이 최소 1팀 필요합니다!');
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

        io.to(pinCode).emit('gameStarted', {
            phase: 'creating',
            currentStage: gameState.currentStage,
            currentRound: gameState.currentRound,
            creator: appraiser,
            teams: gameState.teams
        });

        console.log(`게임 시작! 방: ${pinCode}`);
    });

    // 위조지폐 제출 (감별사)
    socket.on('submitOriginal', (bill) => {
        const pinCode = socket.pinCode;
        const gameState = rooms[pinCode];

        if (!gameState || gameState.phase !== 'creating') return;

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

        io.to(pinCode).emit('guessingPhase', {
            creator: appraiser,
            usedElements: gameState.usedElements,
            elementCount: gameState.usedElements.length,
            totalElementCount: gameState.totalElementCount,
            timeLeft: 30
        });

        startTimer(pinCode);
        console.log(`[${pinCode}] 감별사가 위조지폐를 제출했습니다. 사용 요소: ${gameState.usedElements.join(', ')}`);
    });

    // 추측 제출 (위조지폐제작자)
    socket.on('submitGuess', (bill) => {
        const pinCode = socket.pinCode;
        const gameState = rooms[pinCode];

        if (!gameState || gameState.phase !== 'guessing') return;

        const team = gameState.teams.find(t => t.id === socket.id);
        if (!team || team.role !== 'counterfeiter') {
            socket.emit('error', '위조지폐범만 제출할 수 있습니다!');
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

        io.to(pinCode).emit('submissionUpdate', {
            submittedCount: submittedTeams.length,
            totalCounterfeiters: counterfeiters.length,
            submittedTeams: submittedTeams.map(t => t.name)
        });

        console.log(`[${pinCode}] ${team.name}이 추측을 제출했습니다.`);

        // 모든 위조지폐범이 제출했는지 확인
        const allSubmitted = counterfeiters.every(t => gameState.submissions[t.id]);

        if (allSubmitted) {
            clearInterval(gameState.timerInterval);
            showRoundResults(pinCode);
        }
    });

    // 다음 라운드
    socket.on('nextRound', () => {
        const pinCode = socket.pinCode;
        const gameState = rooms[pinCode];

        if (!gameState) return;

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

                io.to(pinCode).emit('finalResults', {
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

                io.to(pinCode).emit('stageComplete', {
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

            io.to(pinCode).emit('newRoundGuessing', {
                phase: 'guessing',
                currentStage: gameState.currentStage,
                currentRound: gameState.currentRound,
                creator: appraiser,
                usedElements: gameState.usedElements,
                totalElementCount: gameState.totalElementCount,
                roundResults: gameState.roundResults
            });

            startTimer(pinCode);
        }
    });

    // 다음 단계 시작
    socket.on('startNextStage', () => {
        const pinCode = socket.pinCode;
        const gameState = rooms[pinCode];

        if (!gameState) return;

        gameState.phase = 'creating';
        gameState.originalBill = null;
        gameState.submissions = {};
        gameState.usedElements = [];
        gameState.totalElementCount = 0;

        const appraiser = gameState.teams.find(t => t.role === 'appraiser');

        io.to(pinCode).emit('newRound', {
            phase: 'creating',
            currentStage: gameState.currentStage,
            currentRound: gameState.currentRound,
            creator: appraiser,
            roundResults: gameState.roundResults
        });
    });

    // 게임 재시작
    socket.on('restartGame', () => {
        const pinCode = socket.pinCode;
        const gameState = rooms[pinCode];

        if (!gameState) return;

        resetGame(gameState);
        io.to(pinCode).emit('gameReset', {
            teams: gameState.teams
        });
        console.log(`[${pinCode}] 게임이 재시작되었습니다.`);
    });

    // 연결 해제
    socket.on('disconnect', () => {
        console.log('연결 해제:', socket.id);

        const pinCode = socket.pinCode;
        if (!pinCode) return;

        const gameState = rooms[pinCode];
        if (!gameState) return;

        const index = gameState.teams.findIndex(t => t.id === socket.id);
        if (index !== -1) {
            const team = gameState.teams[index];
            gameState.teams.splice(index, 1);
            delete gameState.roundResults[socket.id];

            io.to(pinCode).emit('teamLeft', {
                teams: gameState.teams,
                leftTeam: team
            });

            console.log(`[${pinCode}] 팀 퇴장: ${team.name}`);

            // 감별사(방장)가 나갔으면 방 삭제
            if (team.role === 'appraiser') {
                clearInterval(gameState.timerInterval);
                io.to(pinCode).emit('roomClosed', '방장이 나가서 방이 닫혔습니다.');
                delete rooms[pinCode];
                console.log(`[${pinCode}] 방 삭제됨`);
            }

            // 위조지폐범이 모두 나갔으면 게임 리셋 (방은 유지)
            const counterfeiters = gameState.teams.filter(t => t.role === 'counterfeiter');
            if (counterfeiters.length === 0 && gameState.gameStarted) {
                resetGame(gameState);
                io.to(pinCode).emit('gameReset', {
                    teams: gameState.teams
                });
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
