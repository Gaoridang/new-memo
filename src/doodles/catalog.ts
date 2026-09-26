// 메모의 낱말 옆에 그려 주는 두들 목록. Jev가 고르는 선택지이자, 그림 세트가 모두 그려야 하는 목록이다.
// 설명은 Jev에 그대로 보낸다. 한국어 메모에 영어가 섞이므로 영어 낱말도 함께 적었다.
// (이 파일은 다른 파일을 가져오지 않는다 — 서버 라우트와 기준값 확인 스크립트가 함께 쓴다)
export const DOODLES = {
  coffee: '커피·카페·라떼·아메리카노·차 한 잔 (coffee, cafe, latte, tea)',
  meal: '밥·식사·아침·점심·저녁·라면·국수·도시락·요리 (meal, lunch, dinner, noodles, cooking)',
  cake: '케이크·생일·디저트 (cake, birthday, dessert)',
  bread: '빵·식빵·베이커리·토스트·샌드위치 (bread, bakery, toast, sandwich)',
  fruit: '사과·배·딸기·귤·과일 (apple, pear, strawberry, fruit)',
  milk: '우유·두유·요거트 (milk, yogurt)',
  egg: '계란·달걀·계란후라이 (egg, fried egg)',
  water: '물·물 마시기·생수 (water, drink water)',
  chicken: '치킨·닭다리·통닭 (fried chicken, drumstick)',
  pizza: '피자 (pizza)',
  beer: '맥주·술·와인·소주·회식 (beer, wine, drinks)',
  sun: '해·햇빛·맑음·여름·해돋이 (sun, sunny, summer)',
  rain: '비·우산·장마·소나기 (rain, umbrella)',
  snow: '눈·눈사람·겨울·스키 (snow, snowman, winter, ski)',
  moon: '달·밤·잠·수면·낮잠·자기 (moon, night, sleep, nap)',
  star: '별·중요·꼭·목표 (star, important, goal)',
  flower: '꽃·꽃다발·봄·벚꽃 (flower, bouquet, spring)',
  plant: '화분·식물·새싹·물 주기 (plant, sprout, watering)',
  mountain: '산·등산·하이킹·캠핑 (mountain, hiking, camping)',
  cat: '고양이·냥이·집사 (cat, kitten)',
  dog: '강아지·개·댕댕이·반려견 (dog, puppy)',
  book: '책·독서·도서관·소설·반납 (book, reading, library)',
  pencil: '공부·숙제·과제·시험·필기 (study, homework, exam, notes)',
  laptop: '노트북·컴퓨터·코딩·작업·업무·보고서 (laptop, computer, coding, work, report)',
  phone: '전화·통화·연락·핸드폰·문자 (phone, call, text message)',
  mail: '메일·편지·이메일·우편·답장 (mail, letter, email, reply)',
  chat: '회의·미팅·대화·상담·면접 (meeting, talk, interview, chat)',
  calendar: '일정·약속·예약·날짜·스케줄 (schedule, appointment, reservation, date)',
  alarm: '알람·기상·늦잠·시간 맞추기 (alarm, wake up, oversleep)',
  gift: '선물·포장·기념일·서프라이즈 (gift, present, anniversary)',
  package: '택배·배송·주문·반품·박스 (package, delivery, order, return)',
  shopping: '장보기·쇼핑·마트·구매·세일 (shopping, groceries, buy, sale)',
  money: '돈·월급·월세·입금·송금·은행·카드값·적금 (money, salary, rent, bank, payment)',
  workout: '운동·헬스·근력·PT·요가 (workout, gym, exercise, yoga)',
  running: '달리기·러닝·조깅·마라톤·걷기·산책 (running, jogging, marathon, walking)',
  music: '음악·노래·피아노·기타·콘서트·노래방 (music, song, piano, guitar, concert)',
  movie: '영화·드라마·넷플릭스·극장·팝콘 (movie, film, drama, theater)',
  camera: '사진·카메라·촬영·인화·셀카 (photo, camera, selfie)',
  plane: '여행·비행기·공항·출장·항공권 (travel, flight, airport, trip)',
  car: '자동차·차·운전·주차·세차·주유 (car, drive, parking)',
  house: '집·이사·인테리어·귀가 (home, house, moving)',
  laundry: '빨래·세탁·옷·세탁소·드라이클리닝 (laundry, clothes, dry cleaning)',
  cleaning: '청소·정리·설거지·분리수거 (cleaning, tidying, dishes, recycling)',
  pill: '약·병원·치과·영양제·비타민·건강검진 (medicine, hospital, dentist, vitamins)',
  heart: '사랑·데이트·연애·고마움 (love, date, thanks)',
  idea: '아이디어·생각·기획·영감 (idea, brainstorm, inspiration)',
  party: '축하·파티·합격·결혼식·축제 (celebration, party, congrats, wedding)',
} as const;

export type DoodleId = keyof typeof DOODLES;

export const DOODLE_IDS = Object.keys(DOODLES) as DoodleId[];

export function isDoodleId(value: unknown): value is DoodleId {
  return typeof value === 'string' && Object.hasOwn(DOODLES, value);
}
