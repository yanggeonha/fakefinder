# 위조지폐 찾기 게임 (FakeFinder)

GAN 개념을 활용한 실시간 멀티플레이어 추리 게임

## 게임 방법

1. **팀 입장**: 팀 이름 입력 후 "위조지폐 제작자" 또는 "경찰" 역할 선택
2. **게임 시작**: 최소 2팀 이상 입장 시 게임 시작 가능
3. **제작 단계**: 현재 제작자가 6x4 격자에 요소를 배치하여 위조지폐 제작
4. **추측 단계**: 모든 경찰 팀이 30초 안에 동시에 위조지폐를 추측하여 제출
5. **결과**: 각 팀별 일치율 표시 (80% 이상이면 "검거!")
6. **5라운드** 진행 후 최종 점수로 우승팀 결정

## 배치 가능한 요소

- 👤 인물
- 🏛️ 로고
- 💧 워터마크
- 🔢 일련번호
- 🌀 무늬
- 🔖 도장

## 로컬 실행

```bash
npm install
npm start
```

http://localhost:3000 에서 게임 접속

## Render.com 배포

1. GitHub에 이 레포지토리 push
2. [Render.com](https://render.com) 가입 (GitHub 계정으로)
3. Dashboard → New → Web Service
4. GitHub 레포지토리 연결
5. 설정:
   - Build Command: `npm install`
   - Start Command: `npm start`
6. Create Web Service 클릭
7. 배포 완료 후 제공된 URL로 접속!
