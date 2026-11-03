<script setup>
defineProps({
  userName: { type: String, default: '' }, // 로그인했을 때만 값이 있음
  activeTab: { type: String, default: 'home' }, // 'home' 홈 / 'invest' 내 투자 / 'returns' 수익률 / 'deposits' 입출금 / 'dividends' 배당
})
const emit = defineEmits(['logout', 'navigate'])
</script>

<template>
  <header class="topbar">
    <div class="topbar-inner">
      <div class="brand">Stocky<span>.</span></div>
      <nav v-if="userName" class="nav d-only" aria-label="주 메뉴">
        <button type="button" :class="{ active: activeTab === 'home' }" :aria-current="activeTab === 'home' ? 'page' : undefined" @click="emit('navigate', 'home')">홈</button>
        <button type="button" :class="{ active: activeTab === 'invest' }" :aria-current="activeTab === 'invest' ? 'page' : undefined" @click="emit('navigate', 'invest')">내 투자</button>
        <button type="button" :class="{ active: activeTab === 'returns' }" :aria-current="activeTab === 'returns' ? 'page' : undefined" @click="emit('navigate', 'returns')">수익률</button>
        <button type="button" :class="{ active: activeTab === 'deposits' }" :aria-current="activeTab === 'deposits' ? 'page' : undefined" @click="emit('navigate', 'deposits')">입출금</button>
        <button type="button" :class="{ active: activeTab === 'dividends' }" :aria-current="activeTab === 'dividends' ? 'page' : undefined" @click="emit('navigate', 'dividends')">배당</button>
        <button type="button" :class="{ active: activeTab === 'auto' }" :aria-current="activeTab === 'auto' ? 'page' : undefined" @click="emit('navigate', 'auto')">자동매매</button>
      </nav>
      <div class="header-actions">
        <label v-if="userName" class="search d-only">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input type="search" placeholder="종목을 검색해보세요" aria-label="종목 검색">
        </label>
        <button v-if="userName" class="icon-btn m-only" aria-label="검색">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        </button>
        <button v-if="userName" class="icon-btn" aria-label="알림">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        </button>
        <template v-if="userName">
          <span class="user-name d-only">{{ userName }}님</span>
          <button class="chip-btn logout-btn" @click="emit('logout')">로그아웃</button>
        </template>
      </div>
    </div>
  </header>
</template>
