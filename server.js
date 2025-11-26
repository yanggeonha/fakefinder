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
    phase: 'lobby', // lobby, creating, guessing, result, final
    currentRound: 1,
    maxRounds: 5,
    currentCreatorIndex: 0,
    originalBill: null,
    submissions: {},
    scores: {},
    timerInterval: null,
    timeLeft: 30,
    gameStarted: false
};

// 빈 지폐 생성
function createEmptyBill() {
    return {
        grid: Array(24).fill(null),
        amount: '10000'
    };
}

// 일치율 계산
function calculateMatchRate(original, submitted) {
    let matches = 0;
    let total = 0;

    for (let i = 0; i < 24; i++) {
        if (original.grid[i] !== null || submitted.grid[i] !== null) {
            total++;
            if (original.grid[i] === submitted.grid[i]) {
                matches++;
            }
        }
    }

    total++;
    if (original.amount === submitted.amount) {
        matches++;
    }

    if (total === 0) return 0;
    return Math.round((matches / total) * 100);
}

// 게임 상태 초기화
function resetGame() {
    gameState.teams = [];
    gameState.phase = 'lobby';
    gameState.currentRound = 1;
    gameState.currentCreatorIndex = 0;
    gameState.originalBill = null;
    gameState.submissions = {};
    gameState.scores = {};
    gameState.gameStarted = false;
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
            gameState.teams.forEach(team => {
                if (team.id !== gameState.teams[gameState.currentCreatorIndex].id) {
                    if (!gameState.submissions[team.id]) {
                        gameState.submissions[team.id] = createEmptyBill();
                    }
                }
            });
            showResults();
        }
    }, 1000);
}

// 결과 계산 및 전송
function showResults() {
    clearInterval(gameState.timerInterval);
    gameState.phase = 'result';

    const creator = gameState.teams[gameState.currentCreatorIndex];
    const results = [];

    gameState.teams.forEach(team => {
        if (team.id !== creator.id) {
            const submission = gameState.submissions[team.id] || createEmptyBill();
            const matchRate = calculateMatchRate(gameState.originalBill, submission);

            if (matchRate >= 80) {
                gameState.scores[team.id] = (gameState.scores[team.id] || 0) + 1;
            }

            results.push({
                teamId: team.id,
                teamName: team.name,
                matchRate: matchRate,
                submission: submission,
                caught: matchRate >= 80
            });
        }
    });

    const isLastTurn = gameState.currentCreatorIndex >= gameState.teams.length - 1;
    const isLastRound = gameState.currentRound >= gameState.maxRounds && isLastTurn;

    io.emit('showResults', {
        creator: creator,
        originalBill: gameState.originalBill,
        results: results,
        isLastRound: isLastRound,
        scores: gameState.scores
    });
}

// Socket.io 연결 처리
io.on('connection', (socket) => {
    console.log('새 연결:', socket.id);

    // 현재 게임 상태 전송
    socket.emit('gameState', {
        teams: gameState.teams,
        phase: gameState.phase,
        currentRound: gameState.currentRound,
        gameStarted: gameState.gameStarted,
        scores: gameState.scores
    });

    // 팀 입장
    socket.on('joinTeam', (data) => {
        if (gameState.gameStarted) {
            socket.emit('error', '게임이 이미 시작되었습니다!');
            return;
        }

        if (gameState.teams.length >= 10) {
            socket.emit('error', '최대 10팀까지만 참가할 수 있습니다!');
            return;
        }

        if (gameState.teams.some(t => t.name === data.name)) {
            socket.emit('error', '이미 존재하는 팀 이름입니다!');
            return;
        }

        const team = {
            id: socket.id,
            name: data.name,
            role: data.role
        };

        gameState.teams.push(team);
        gameState.scores[team.id] = 0;

        socket.team = team;

        io.emit('teamJoined', {
            teams: gameState.teams,
            newTeam: team
        });

        console.log(`팀 입장: ${team.name} (${team.role})`);
    });

    // 게임 시작
    socket.on('startGame', () => {
        if (gameState.teams.length < 2) {
            socket.emit('error', '최소 2팀이 필요합니다!');
            return;
        }

        if (gameState.gameStarted) return;

        gameState.gameStarted = true;
        gameState.phase = 'creating';
        gameState.currentRound = 1;
        gameState.currentCreatorIndex = 0;

        const creator = gameState.teams[gameState.currentCreatorIndex];

        io.emit('gameStarted', {
            phase: 'creating',
            currentRound: gameState.currentRound,
            creator: creator,
            teams: gameState.teams
        });

        console.log('게임 시작!');
    });

    // 위조지폐 제출 (제작자)
    socket.on('submitOriginal', (bill) => {
        if (gameState.phase !== 'creating') return;

        const creator = gameState.teams[gameState.currentCreatorIndex];
        if (socket.id !== creator.id) {
            socket.emit('error', '당신은 현재 제작자가 아닙니다!');
            return;
        }

        gameState.originalBill = bill;
        gameState.phase = 'guessing';
        gameState.submissions = {};

        io.emit('guessingPhase', {
            creator: creator,
            timeLeft: 30
        });

        startTimer();
        console.log(`${creator.name}이 위조지폐를 제출했습니다.`);
    });

    // 추측 제출 (경찰)
    socket.on('submitGuess', (bill) => {
        if (gameState.phase !== 'guessing') return;

        const creator = gameState.teams[gameState.currentCreatorIndex];
        if (socket.id === creator.id) {
            socket.emit('error', '제작자는 제출할 수 없습니다!');
            return;
        }

        if (gameState.submissions[socket.id]) {
            socket.emit('error', '이미 제출했습니다!');
            return;
        }

        gameState.submissions[socket.id] = bill;

        // 제출 현황 브로드캐스트
        const submittedTeams = gameState.teams.filter(t =>
            t.id !== creator.id && gameState.submissions[t.id]
        );

        io.emit('submissionUpdate', {
            submittedCount: submittedTeams.length,
            totalPolice: gameState.teams.length - 1,
            submittedTeams: submittedTeams.map(t => t.name)
        });

        console.log(`${socket.team?.name || socket.id}이 추측을 제출했습니다.`);

        // 모든 경찰이 제출했는지 확인
        const allSubmitted = gameState.teams.every(team =>
            team.id === creator.id || gameState.submissions[team.id]
        );

        if (allSubmitted) {
            clearInterval(gameState.timerInterval);
            showResults();
        }
    });

    // 다음 라운드
    socket.on('nextRound', () => {
        gameState.currentCreatorIndex++;

        if (gameState.currentCreatorIndex >= gameState.teams.length) {
            gameState.currentCreatorIndex = 0;
            gameState.currentRound++;
        }

        if (gameState.currentRound > gameState.maxRounds) {
            // 최종 결과
            gameState.phase = 'final';

            const finalScores = gameState.teams.map(team => ({
                id: team.id,
                name: team.name,
                score: gameState.scores[team.id] || 0
            })).sort((a, b) => b.score - a.score);

            io.emit('finalResults', {
                scores: finalScores,
                winner: finalScores[0]
            });
        } else {
            // 다음 라운드
            gameState.phase = 'creating';
            gameState.originalBill = null;
            gameState.submissions = {};

            const creator = gameState.teams[gameState.currentCreatorIndex];

            io.emit('newRound', {
                phase: 'creating',
                currentRound: gameState.currentRound,
                creator: creator
            });
        }
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
            delete gameState.scores[socket.id];

            io.emit('teamLeft', {
                teams: gameState.teams,
                leftTeam: team
            });

            console.log(`팀 퇴장: ${team.name}`);

            // 게임 중에 제작자가 나갔으면 다음으로 넘김
            if (gameState.gameStarted && gameState.teams.length > 0) {
                if (gameState.currentCreatorIndex >= gameState.teams.length) {
                    gameState.currentCreatorIndex = 0;
                }
            }

            // 팀이 1팀 이하면 로비로
            if (gameState.teams.length < 2 && gameState.gameStarted) {
                resetGame();
                io.emit('gameReset');
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
