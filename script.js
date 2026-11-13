(() => {
  const $ = (id) => document.getElementById(id);
  const defaultTask = "Prepare my data structures assignment";
  const winsStorageKey = "unstuck-wins";
  const rescueStorageKey = "unstuck-rescue-progress";
  const workspaceStorageKey = "unstuck-workspace-progress";
  const focusSessionStorageKey = "unstuck-focus-session";
  const tasksStorageKey = "unstuck-task-list";
  const settingsStorageKey = "unstuck-settings";
  const rescueSeconds = 20;

  const defaults = {
    type: "study",
    task: defaultTask,
    minutes: 5,
    energy: "medium",
    barrier: "start"
  };

  let energy = defaults.energy;
  let wins = [];
  let storageAvailable = true;
  let seconds = defaults.minutes * 60;
  let timerId = null;
  let paused = false;
  let activeSession = null;
  let focusWasInterrupted = false;
  let currentPlan = [];
  let currentPlanKey = "";
  let planGenerated = false;
  let completedSteps = [];
  let selectedStepIndex = 0;
  let planWinRecorded = false;
  let flowStage = "task";
  let toastTimer = null;
  let barrier = "start";
  let rescueProgress = { attempts: 0, completed: 0, strategies: {} };
  let rescueState = null;
  let rescueTimerId = null;
  let rescueSecondsLeft = rescueSeconds;
  let tasks = [];
  let reduceMotion = false;

  const taskNouns = {
    study: "your study task",
    coding: "your coding task",
    writing: "your writing task",
    research: "your research task",
    admin: "your life-admin task",
    other: "your task"
  };

  const energyText = {
    low: "Low energy is allowed. We'll make the first step almost frictionless.",
    medium: "We'll keep the first step clear and manageable.",
    high: "You have a little momentum. We can make the first step more active."
  };

  function task() {
    return $("taskText").value.trim() ||
      taskNouns[$("taskType").value] ||
      "your task";
  }

  function saveWorkspaceProgress() {
    try {
      window.localStorage.setItem(workspaceStorageKey, JSON.stringify({
        version: 1,
        type: $("taskType").value,
        minutes: Number($("minutes").value),
        energy,
        barrier,
        completedSteps,
        selectedStepIndex,
        planWinRecorded,
        planGenerated,
        taskText: $("taskText").value,
        flowStage
      }));
    } catch (error) {
      storageAvailable = false;
    }
  }

  function saveFocusSession() {
    try {
      if (!activeSession || activeSession.recorded) {
        window.sessionStorage.removeItem(focusSessionStorageKey);
        return;
      }
      window.sessionStorage.setItem(focusSessionStorageKey, JSON.stringify({
        version: 1,
        session: activeSession,
        seconds
      }));
    } catch (error) {
      storageAvailable = false;
    }
  }

  function clearFocusSession() {
    try {
      window.sessionStorage.removeItem(focusSessionStorageKey);
    } catch (error) {
      storageAvailable = false;
    }
  }

  function loadFocusSession() {
    let stored;
    try {
      stored = window.sessionStorage.getItem(focusSessionStorageKey);
    } catch (error) {
      storageAvailable = false;
      return null;
    }
    if (!stored) return null;

    let parsed;
    try {
      parsed = JSON.parse(stored);
    } catch (error) {
      clearFocusSession();
      return null;
    }

    try {
      const session = parsed && parsed.session;
      if (
        !parsed ||
        parsed.version !== 1 ||
        !session ||
        typeof session.task !== "string" ||
        typeof session.firstStep !== "string" ||
        !Number.isInteger(session.minutes) ||
        session.minutes < 2 ||
        session.minutes > 25 ||
        session.recorded !== false ||
        !Number.isInteger(parsed.seconds) ||
        parsed.seconds < 0 ||
        parsed.seconds > session.minutes * 60
      ) {
        window.sessionStorage.removeItem(focusSessionStorageKey);
        return null;
      }
      return {
        session: {
          ...session,
          stepIndex: Number.isInteger(session.stepIndex) && session.stepIndex >= 0
            ? session.stepIndex
            : 0
        },
        seconds: parsed.seconds
      };
    } catch (error) {
      storageAvailable = false;
      return null;
    }
  }

  function loadWorkspaceProgress() {
    const fallback = {
      type: defaults.type,
      minutes: defaults.minutes,
      energy: defaults.energy,
      barrier: defaults.barrier,
      completedSteps: [],
      selectedStepIndex: 0,
      planWinRecorded: false,
      planGenerated: false,
      taskText: defaults.task,
      flowStage: "task"
    };

    let stored;
    try {
      stored = window.localStorage.getItem(workspaceStorageKey);
    } catch (error) {
      storageAvailable = false;
      return fallback;
    }
    if (!stored) return fallback;

    let parsed;
    try {
      parsed = JSON.parse(stored);
    } catch (error) {
      return fallback;
    }
    if (!parsed || typeof parsed !== "object" || parsed.version !== 1) return fallback;

    return {
      type: ["study", "coding", "writing", "research", "admin", "other"].includes(parsed.type)
        ? parsed.type
        : fallback.type,
      minutes: Number.isInteger(parsed.minutes) && parsed.minutes >= 2 && parsed.minutes <= 25
        ? parsed.minutes
        : fallback.minutes,
      energy: ["low", "medium", "high"].includes(parsed.energy)
        ? parsed.energy
        : fallback.energy,
      barrier: ["start", "big", "energy", "fear", "distracted", "postponing"].includes(parsed.barrier)
        ? parsed.barrier
        : fallback.barrier,
      completedSteps: Array.isArray(parsed.completedSteps) && parsed.completedSteps.length === 3
        ? parsed.completedSteps.map(value => value === true)
        : fallback.completedSteps,
      selectedStepIndex: Number.isInteger(parsed.selectedStepIndex) &&
        parsed.selectedStepIndex >= 0 && parsed.selectedStepIndex < 3
        ? parsed.selectedStepIndex
        : 0,
      planWinRecorded: parsed.planWinRecorded === true,
      planGenerated: parsed.planGenerated === true,
      taskText: typeof parsed.taskText === "string" && parsed.taskText.length <= 180
        ? parsed.taskText
        : fallback.taskText,
      flowStage: ["task", "setup", "plan"].includes(parsed.flowStage)
        ? parsed.flowStage
        : fallback.flowStage
    };
  }

  function loadTasks() {
    try {
      const stored = window.localStorage.getItem(tasksStorageKey);
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(item =>
        item &&
        typeof item.id === "string" &&
        typeof item.title === "string" &&
        item.title.trim().length > 0 &&
        typeof item.completed === "boolean"
      );
    } catch (error) {
      storageAvailable = false;
      return [];
    }
  }

  function saveTasks() {
    try {
      window.localStorage.setItem(tasksStorageKey, JSON.stringify(tasks));
    } catch (error) {
      storageAvailable = false;
    }
  }

  function loadSettings() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(settingsStorageKey) || "{}");
      return {
        reduceMotion: Boolean(parsed && parsed.reduceMotion === true),
        minutes: Number.isInteger(parsed && parsed.minutes) && parsed.minutes >= 2 && parsed.minutes <= 25
          ? parsed.minutes
          : 5,
        energy: parsed && ["low", "medium", "high"].includes(parsed.energy)
          ? parsed.energy
          : "medium",
        barrier: parsed && ["start", "big", "energy", "fear", "distracted", "postponing"].includes(parsed.barrier)
          ? parsed.barrier
          : "start"
      };
    } catch (error) {
      storageAvailable = false;
      return { reduceMotion: false, minutes: 5, energy: "medium", barrier: "start" };
    }
  }

  function saveSettings() {
    try {
      window.localStorage.setItem(settingsStorageKey, JSON.stringify({
        version: 1,
        reduceMotion,
        minutes: defaults.minutes,
        energy: defaults.energy,
        barrier: defaults.barrier
      }));
    } catch (error) {
      storageAvailable = false;
    }
  }

  function renderTaskList() {
    const list = $("taskList");
    list.replaceChildren();
    $("taskTotal").textContent = String(tasks.length);
    $("taskEmpty").hidden = tasks.length > 0;

    tasks.forEach(item => {
      const card = document.createElement("article");
      card.className = "task-card" + (item.completed ? " is-completed" : "");
      card.dataset.taskId = item.id;

      const completeButton = document.createElement("button");
      completeButton.className = "task-complete";
      completeButton.type = "button";
      completeButton.dataset.taskAction = "toggle";
      completeButton.setAttribute("aria-label", (item.completed ? "Reopen " : "Mark as complete (optional): ") + item.title);
      completeButton.setAttribute("aria-pressed", String(item.completed));
      completeButton.textContent = item.completed ? "✓" : "";

      const title = document.createElement("strong");
      title.className = "task-card-title";
      title.textContent = item.title;

      const state = document.createElement("span");
      state.className = "task-card-state";
      state.textContent = item.completed ? "Completed" : "Ready when you are";

      const planButton = document.createElement("button");
      planButton.className = "task-plan-button";
      planButton.type = "button";
      planButton.dataset.taskAction = "plan";
      planButton.textContent = "Select task →";
      planButton.setAttribute("aria-label", "Select task " + item.title);

      const deleteButton = document.createElement("button");
      deleteButton.className = "task-delete";
      deleteButton.type = "button";
      deleteButton.dataset.taskAction = "delete";
      deleteButton.textContent = "×";
      deleteButton.setAttribute("aria-label", "Delete " + item.title);

      const copy = document.createElement("div");
      copy.className = "task-card-copy";
      copy.append(title, state);
      card.append(completeButton, copy, planButton, deleteButton);
      list.append(card);
    });
  }

  function renderProgressDashboard() {
    const completeTasks = tasks.filter(item => item.completed).length;
    const percent = tasks.length ? Math.round(completeTasks / tasks.length * 100) : 0;
    const completeSteps = completedSteps.filter(Boolean).length;
    const totalSteps = currentPlan.length;

    $("taskProgressRing").style.setProperty("--task-progress", percent + "%");
    $("taskProgressRing").setAttribute("aria-label", `${completeTasks} of ${tasks.length} tasks complete`);
    $("taskProgressPercent").textContent = percent + "%";
    $("progressTaskSummary").textContent = tasks.length
      ? `${completeTasks} of ${tasks.length} tasks complete`
      : "Your first step is waiting.";
    $("progressTaskDetail").textContent = tasks.length
      ? `${tasks.length - completeTasks} ${tasks.length - completeTasks === 1 ? "task is" : "tasks are"} still here when you're ready.`
      : "Add a task in My Plan and choose a small place to begin.";
    $("progressWinCount").textContent = String(wins.length);
    $("progressRescueCount").textContent = String(rescueProgress.completed);
    $("progressCompletedTasks").textContent = String(completeTasks);
    $("progressStepCount").textContent = `${completeSteps} of ${totalSteps} steps`;
    $("dashboardStepBar").style.width = (totalSteps ? completeSteps / totalSteps * 100 : 0) + "%";
    const dashboardTrack = document.querySelector(".progress-latest [role='progressbar']");
    dashboardTrack.setAttribute("aria-valuenow", String(completeSteps));
    $("dashboardStepNote").textContent = totalSteps
      ? completeSteps === totalSteps
        ? "All the steps in your current plan are checked off."
        : `${completeSteps} ${completeSteps === 1 ? "step" : "steps"} checked. You can take the next one at your own pace.`
      : "Open My Plan to make a small plan.";
  }

  function renderSettings() {
    $("motionSetting").checked = reduceMotion;
    $("defaultMinutes").value = String(defaults.minutes);
    $("defaultMinutesValue").textContent = `${defaults.minutes} minutes`;
    $("defaultEnergy").value = defaults.energy;
    $("defaultBarrier").value = defaults.barrier;
    $("localStatusText").textContent = storageAvailable
      ? "Saved on this device"
      : "Browser storage unavailable";
  }

  function celebrateWorld() {
    const scene = $("worldScene");
    scene.classList.remove("is-win-celebration");
    void scene.offsetWidth;
    scene.classList.add("is-win-celebration");
    setTimeout(() => scene.classList.remove("is-win-celebration"), 900);
  }

  function fitPlanToTime(steps, minutes) {
    const timeNote = minutes <= 5
      ? ` With ${minutes} minutes, this first action can be the whole goal; the rest is optional.`
      : minutes <= 12
        ? ` With ${minutes} minutes, start with this action and choose at most one more.`
        : ` With ${minutes} minutes, take this one action at a time and stop when you've done enough.`;
    const fitted = steps.map(step => [...step]);
    fitted[0][1] += timeNote;
    return fitted;
  }

  function makeSteps(type, level, stuckness, minutes) {
    const steps = {
      study: [
        ["Open the assignment or notes", "Find the right file or page. No solving yet."],
        ["Read one instruction", "Underline the key question or unknown."],
        ["Write one rough note", "Record one thing you know or need to find out."]
      ],
      coding: [
        ["Open the project", "Launch your editor and find the relevant file."],
        ["Run or inspect one thing", "Look at the output, error, or next requirement."],
        ["Make one tiny change", "Add a note, test a line, or define the next action."]
      ],
      writing: [
        ["Open a blank draft", "Give the document a working title."],
        ["Write three rough bullets", "Capture ideas without editing them."],
        ["Choose one bullet to expand", "Turn one fragment into a rough sentence."]
      ],
      research: [
        ["Open the paper or source", "Find the title and abstract."],
        ["Read one heading", "Notice how the source is organized."],
        ["Write one question", "Capture one thing you want to learn."]
      ],
      admin: [
        ["Gather what you need", "Open the form, message, list, or item."],
        ["Do the first visible action", "Fill one field or find one detail."],
        ["Decide the next tiny action", "Leave yourself a clear reminder."]
      ],
      other: [
        ["Open or locate the task", "Put the relevant thing in front of you."],
        ["Name the very next action", "Use a verb: open, read, write, find, or send."],
        ["Do that action imperfectly", "Aim for a start, not a finished result."]
      ]
    };

    const list = (steps[type] || steps.other).map(step => [...step]);

    if (level === "low") {
      list[0] = [
        "Make the task visible",
        "Open the file, page, or object. You can stop there."
      ];
    }

    if (level === "high") {
      list[2] = [
        "Make one visible bit of progress",
        "Write a rough answer, run a small test, or finish one tiny piece."
      ];
    }

    const barrierSteps = {
      start: [
        ["Find the right starting point", "Open the task and locate one heading, file, or first visible section."],
        ["Name one next action", "Choose a single verb: read, open, write, find, or send."],
        ["Try that one action", "Give the first step a short, low-pressure attempt."]
      ],
      big: [
        ["Choose one small piece", "Name just one paragraph, problem, file, or item—not the whole task."],
        ["Set the rest aside", "Keep only that one piece in view for now."],
        ["Make a tiny start on it", "Read one line, write one note, or inspect one detail."]
      ],
      energy: [
        ["Put the task within reach", "Open the file, page, or item. You can stop right there."],
        ["Look at one small detail", "Read a heading or glance at the first line—no need to act yet."],
        ["Leave yourself a next-step note", "One short reminder is enough for another time."]
      ],
      fear: [
        ["Make a deliberately rough first mark", "Write a placeholder, test note, or messy draft. It is allowed to be imperfect."],
        ["Keep it as a draft", "Don't edit or judge it yet; just let a first version exist."],
        ["Choose one part to leave imperfect", "A small imperfect start is useful information, not a final result."]
      ],
      distracted: [
        ["Quiet one source of interruption", "Silence one notification or put one distracting tab away."],
        ["Bring only the task into view", "Open the one file, page, or item you need."],
        ["Stay with one tiny action", "Read one line or make one small note before switching."]
      ],
      postponing: [
        ["Set up a 20-second start", "Open the task and get the first item ready—no commitment beyond that."],
        ["Begin before deciding to continue", "Try one tiny action while the task is already open."],
        ["Leave a breadcrumb", "Write down the next easy action so restarting takes less effort."]
      ]
    };

    if (barrierSteps[stuckness]) {
      const adapted = barrierSteps[stuckness].map(step => [...step]);
      const tailoredStarts = {
        big: {
          study: ["Choose one question from the assignment", "Leave the other questions for later."],
          coding: ["Choose one relevant file", "You only need to look at this file for now."],
          writing: ["Pick one idea for a single paragraph", "A whole draft is not today's first step."],
          research: ["Read one sentence from the abstract", "You do not need to understand the whole paper yet."],
          admin: ["Choose one field or item", "The rest of the form or list can wait."],
          other: ["Choose one small piece of the task", "The rest can wait while you begin this part."]
        },
        energy: {
          study: ["Open your notes to one heading", "Looking at the page is enough for now."],
          coding: ["Open the project and leave it on screen", "No changes or problem-solving needed yet."],
          writing: ["Open your draft", "You can stop there; no words required yet."],
          research: ["Open the paper to its abstract", "Just getting to the right page is enough."],
          admin: ["Put the one thing you need within reach", "No need to complete a form or send anything now."],
          other: ["Put the task where you can see it", "You can stop after making it visible."]
        },
        fear: {
          study: ["Write a rough first guess", "You can check or revise it later."],
          coding: ["Add a temporary TODO note", "It is a draft thought, not a final change."],
          writing: ["Type one deliberately imperfect sentence", "Do not edit it yet."],
          research: ["Write one rough question about the source", "It does not need to be insightful or polished."],
          admin: ["Draft one imperfect line", "Keep it as a draft; you do not have to send it."],
          other: ["Make one deliberately rough first mark", "It can be changed or discarded later."]
        },
        distracted: {
          study: ["Silence one notification, then open your notes", "Bring one page into view."],
          coding: ["Close one extra tab and open the relevant file", "Keep just the project in front of you."],
          writing: ["Hide one distraction and open your draft", "Stay with one blank page."],
          research: ["Close one extra tab and open the paper", "Keep the source in view."],
          admin: ["Move one distraction aside and open the item", "Only the needed form or message has to be visible."],
          other: ["Move one distraction aside and reveal the task", "Focus on just the first visible part."]
        },
        postponing: {
          study: ["Open the assignment and read one heading", "A short visit is enough to break the delay."],
          coding: ["Open the project and locate the likely file", "No coding required for this first move."],
          writing: ["Open the draft and type a placeholder", "You can change it later."],
          research: ["Open the paper and scroll to the abstract", "You only have to arrive at the source."],
          admin: ["Open the one message or form", "You do not need to finish or send it yet."],
          other: ["Open the task and get its first item ready", "You can decide what comes next afterward."]
        }
      };
      adapted[0] = (tailoredStarts[stuckness] && tailoredStarts[stuckness][type]) || list[0];
      if (level === "low") {
        adapted[1] = [
          "Optional: notice one detail",
          "Only if it feels easy, look at one line or heading. Stopping after the first step counts."
        ];
        adapted[2] = [
          "Stop after one tiny try",
          "You can leave the next step for later. A small start is enough."
        ];
      } else if (level === "high" && stuckness !== "energy") {
        adapted[2] = [
          "Use a little momentum",
          "Take one extra small action if it feels useful; stopping is fine too."
        ];
      }
      return fitPlanToTime(adapted, minutes);
    }

    return fitPlanToTime(list, minutes);
  }

  function showView(name) {
    if (name === "focus" && !activeSession) {
      name = "workspace";
      showToast("Start a focus session from your first step.");
    }

    document.querySelectorAll('[data-nav="focus"]').forEach(link => {
      link.hidden = !activeSession;
    });

    if (timerId !== null && name !== "focus") {
      stopTimer();
      paused = true;
      renderFocus();
      saveFocusSession();
      showToast("Focus paused while you switch screens. Resume whenever you're ready.");
    }
    if (rescueTimerId !== null && name !== "workspace") {
      stopRescueTimer();
      renderRescue();
    }

    document.querySelectorAll("[data-view]").forEach(view => {
      const isActive = view.dataset.view === name;
      view.hidden = !isActive;
      view.classList.toggle("active", isActive);
    });

    document.querySelectorAll("[data-nav]").forEach(link => {
      if (link.tagName === "BUTTON") {
        if (link.dataset.nav === name) {
          link.setAttribute("aria-current", "page");
        } else {
          link.removeAttribute("aria-current");
        }
      }
    });

    if (name === "workspace") {
      renderTaskList();
      renderProgressDashboard();
      renderWorkflowStage();
    }
    if (name === "focus") renderFocus();
    if (name === "wins") {
      renderWins();
      renderProgressDashboard();
    }
    if (name === "settings") {
      renderSettings();
    }
  }

  function renderWorkflowStage() {
    document.querySelectorAll("[data-stage-panel]").forEach(panel => {
      panel.hidden = panel.dataset.stagePanel !== flowStage;
    });
    document.querySelectorAll("[data-stage-indicator]").forEach(indicator => {
      const stageOrder = ["task", "setup", "plan"];
      const currentIndex = stageOrder.indexOf(flowStage);
      const indicatorIndex = stageOrder.indexOf(indicator.dataset.stageIndicator);
      indicator.classList.toggle("is-current", indicatorIndex === currentIndex);
      indicator.classList.toggle("is-complete", indicatorIndex < currentIndex);
      if (indicatorIndex === currentIndex) indicator.setAttribute("aria-current", "step");
      else indicator.removeAttribute("aria-current");
    });
    $("journeyStatus").textContent = flowStage === "task"
      ? "First, choose what you'd like to start."
      : flowStage === "setup"
        ? `Next, set the time and support for "${task()}".`
        : `Your plan for "${task()}" is ready. Take one step at a time.`;
    $("setupTaskName").textContent = task();
    $("planTaskName").textContent = task();
    if (flowStage !== "plan" && rescueTimerId !== null) {
      stopRescueTimer();
      renderRescue();
    }
    saveWorkspaceProgress();
  }

  function renderPlan() {
    const type = $("taskType").value;
    const minutes = Number($("minutes").value);
    const key = JSON.stringify([type, energy, barrier, minutes, $("taskText").value.trim()]);

    if (key !== currentPlanKey) {
      const hadGeneratedPlan = planGenerated;
      currentPlan = makeSteps(type, energy, barrier, minutes);
      completedSteps = currentPlan.map(() => false);
      selectedStepIndex = 0;
      planWinRecorded = false;
      currentPlanKey = key;
      if (rescueState) {
        stopRescueTimer();
        rescueState = null;
        rescueSecondsLeft = rescueSeconds;
        $("heroOrb").classList.remove("is-rescuing", "is-rescue-success");
        $("rescueOrb").classList.remove("is-rescuing", "is-rescue-success");
        renderRescue();
      }
      if (hadGeneratedPlan) {
        planGenerated = false;
        flowStage = "setup";
      }
    }

    if (!Number.isInteger(selectedStepIndex) || selectedStepIndex < 0 || selectedStepIndex >= currentPlan.length) {
      const nextStep = getNextUnfinishedStep(-1);
      selectedStepIndex = nextStep >= 0 ? nextStep : currentPlan.length - 1;
    }
    const selectedStep = currentPlan[selectedStepIndex];
    $("selectedStepLabel").textContent = `STEP ${selectedStepIndex + 1} · ${completedSteps[selectedStepIndex] ? "COMPLETED" : "SELECTED"}`;
    $("firstStep").textContent = selectedStep[0] + ".";
    $("firstStep").dataset.stepIndex = String(selectedStepIndex);
    $("stepWhy").textContent = selectedStep[1];
    $("planResult").hidden = !planGenerated;
    $("stepCount").textContent = currentPlan.length + " small steps";
    $("stepList").replaceChildren();

    currentPlan.forEach((step, index) => {
      const row = document.createElement("div");
      row.className = "step";
      row.dataset.stepIndex = String(index);

      const number = document.createElement("span");
      number.className = "step-num";
      number.textContent = String(index + 1).padStart(2, "0");

      const selectButton = document.createElement("button");
      selectButton.className = "step-select";
      selectButton.type = "button";
      selectButton.dataset.stepSelect = String(index);
      selectButton.setAttribute("aria-pressed", String(index === selectedStepIndex));
      selectButton.setAttribute("aria-label", `Select step ${index + 1}: ${step[0]}`);
      const copy = document.createElement("span");
      copy.className = "step-copy";
      const title = document.createElement("strong");
      title.textContent = step[0];
      const description = document.createElement("p");
      description.textContent = step[1];
      copy.append(title, description);
      selectButton.append(number, copy);

      const checkbox = document.createElement("input");
      checkbox.className = "step-check";
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(completedSteps[index]);
      checkbox.dataset.stepComplete = String(index);
      checkbox.setAttribute("aria-label", `Mark optional plan step "${step[0]}" complete`);

      row.append(selectButton, checkbox);
      $("stepList").append(row);
    });

    const allStepsComplete = completedSteps.length > 0 && completedSteps.every(Boolean);
    $("planCompleteMessage").hidden = !allStepsComplete;
    $("recordPlanWin").textContent = planWinRecorded ? "Small Win recorded" : "Record a Small Win";
    $("recordPlanWin").disabled = planWinRecorded;
    $("startSession").disabled = Boolean(completedSteps[selectedStepIndex]) || allStepsComplete;
    $("stepStarted").disabled = Boolean(completedSteps[selectedStepIndex]) || allStepsComplete;
    $("stepStarted").hidden = allStepsComplete;
    $("selectedStepLabel").textContent = allStepsComplete
      ? "PLAN COMPLETE"
      : `STEP ${selectedStepIndex + 1} · ${completedSteps[selectedStepIndex] ? "COMPLETED" : "SELECTED"}`;
    $("planTimeGuidance").textContent = minutes <= 5
      ? `With ${minutes} minutes, make the first action the whole goal. The other steps are optional.`
      : minutes <= 12
        ? `With ${minutes} minutes, start here and choose at most one more action. You can stop sooner.`
        : `With ${minutes} minutes, take these one at a time and stop whenever you've done enough.`;

    $("artTask").textContent = selectedStep[0];
    $("focusTitle").textContent = selectedStep[0] + ".";
    $("focusStepInstructions").textContent = selectedStep[1];
    $("focusPrompt").textContent = "You don't have to do it all. Just be here for this bit.";
    $("rescueActionPreview").textContent =
      `For “${selectedStep[0]}”: ${rescueActionFor(type, barrier)}`;
    $("worldScene").dataset.atmosphere = energy;
    renderProgress();
    saveWorkspaceProgress();
  }

  function rescueActionFor(type, stuckness) {
    const baseAction = {
      study: "Read one heading in your notes or assignment.",
      coding: "Open the relevant project file.",
      writing: "Type one imperfect sentence into your draft.",
      research: "Open the paper and read its abstract.",
      admin: "Open the one form, message, or item you need.",
      other: "Bring the task into view and name its first visible part."
    };

    if (stuckness === "energy") {
      const lowEffort = {
        study: "Open your notes and look at one heading.",
        coding: "Open the relevant file and leave it on screen.",
        writing: "Open your draft; no writing required yet.",
        research: "Open the paper and find its abstract.",
        admin: "Put the one item you need within reach.",
        other: "Put the task where you can see it."
      };
      return lowEffort[type] || lowEffort.other;
    }

    if (stuckness === "fear") {
      const imperfectStart = {
        study: "Write one rough guess about the topic—no checking it yet.",
        coding: "Add a temporary TODO note about one thing to try.",
        writing: "Type one deliberately imperfect sentence.",
        research: "Write one rough question you hope the paper answers.",
        admin: "Draft one imperfect line of the message or form.",
        other: "Make one rough first mark; it does not need to be right."
      };
      return imperfectStart[type] || imperfectStart.other;
    }

    if (stuckness === "big") {
      return {
        study: "Read just one heading from the assignment or notes.",
        coding: "Open one file related to the task.",
        writing: "Write one rough bullet for the draft.",
        research: "Read just the first sentence of the abstract.",
        admin: "Handle one field or item, not the whole task.",
        other: "Choose one small visible piece of the task."
      }[type] || "Choose one small visible piece of the task.";
    }

    if (stuckness === "distracted") {
      return {
        study: "Silence one notification, then read one heading.",
        coding: "Close one extra tab and open the relevant file.",
        writing: "Hide one distraction and type one rough sentence.",
        research: "Close one extra tab and read the paper's abstract.",
        admin: "Put away one distraction and open the item you need.",
        other: "Move one distraction aside and bring the task into view."
      }[type] || "Move one distraction aside and bring the task into view.";
    }

    if (stuckness === "postponing") {
      return {
        study: "Open the assignment and read one heading.",
        coding: "Open the project and locate the likely file.",
        writing: "Open the draft and type a placeholder sentence.",
        research: "Open the paper and scroll to its abstract.",
        admin: "Open the one message or form you've been avoiding.",
        other: "Open the task and get its first item ready."
      }[type] || "Open the task and get its first item ready.";
    }

    return baseAction[type] || baseAction.other;
  }

  function update() {
    const minutes = Number($("minutes").value);

    $("minutesValue").textContent = minutes + (minutes === 1 ? " minute" : " minutes");
    $("energyHelp").textContent = barrier === "energy"
      ? "We'll choose a nearly effortless action, even if your energy is low."
      : energyText[energy];
    $("startSize").textContent = minutes + " min";
    $("startSizeText").textContent = minutes <= 5
      ? "A tiny entry point, not a deadline."
      : "A flexible focus window. You can stop earlier.";
    $("successWord").textContent =
      energy === "low" ? "Show up" :
      energy === "high" ? "Make progress" : "Begin";
    $("successText").textContent =
      "Success is starting the next action—not completing the whole task.";
    renderPlan();
    renderWorkflowStage();

    if (!activeSession) {
      seconds = minutes * 60;
      renderTimer();
    }
  }

  function renderProgress() {
    const checked = completedSteps.filter(Boolean).length;
    const total = currentPlan.length;
    const progress = $("stepList").querySelectorAll(".step-check");
    const allStepsComplete = total > 0 && checked === total;

    progress.forEach((checkbox, index) => {
      const row = checkbox.closest(".step");
      checkbox.checked = Boolean(completedSteps[index]);
      if (row) {
        row.classList.toggle("is-done", Boolean(completedSteps[index]));
        row.classList.toggle("is-active", index === selectedStepIndex && !completedSteps[index]);
        row.classList.toggle("is-next", index === getNextUnfinishedStep(selectedStepIndex) && index !== selectedStepIndex);
        row.querySelector(".step-select").setAttribute("aria-pressed", String(index === selectedStepIndex));
      }
    });

    const progressPercent = total ? checked / total * 100 : 0;
    $("progressBar").style.width = progressPercent + "%";
    $("artProgress").style.width = progressPercent + "%";
    $("artProgressLabel").textContent =
      String(checked).padStart(2, "0") + " / " + String(total).padStart(2, "0");
    $("heroOrb").style.setProperty("--progress", progressPercent + "%");
    $("rescueOrb").style.setProperty("--progress", progressPercent + "%");
    $("worldScene").dataset.progress = String(checked);
    const orbGlow = 14 + checked * 5 + "px";
    $("heroOrb").style.setProperty("--orb-glow", orbGlow);
    $("rescueOrb").style.setProperty("--orb-glow", orbGlow);
    $("heroOrb").dataset.progress = String(checked);
    $("rescueOrb").dataset.progress = String(checked);
    const progressTrack = document.querySelector(".steps-content [role='progressbar']");
    progressTrack.setAttribute("aria-valuenow", String(checked));
    $("stepCount").textContent = `${checked} of ${total} checked`;
    $("progressNote").textContent = allStepsComplete
      ? "Every step in this plan is complete. One small win has been saved."
      : checked
        ? `${checked} of ${total} optional steps checked. You can stop after any step.`
        : "Optional checklist progress. Select a step to see its action and instructions.";
    $("stepList").setAttribute("aria-label", `${checked} of ${total} steps complete`);
    $("planCompleteMessage").hidden = !allStepsComplete;
    $("startSession").disabled = Boolean(completedSteps[selectedStepIndex]) || allStepsComplete;
    $("stepStarted").disabled = Boolean(completedSteps[selectedStepIndex]) || allStepsComplete;
    $("stepStarted").hidden = allStepsComplete;
    saveWorkspaceProgress();
    renderProgressDashboard();
  }

  function pulseOrb() {
    ["heroOrb", "rescueOrb"].forEach(id => {
      const orb = $(id);
      orb.classList.remove("is-rippling");
      void orb.offsetWidth;
      orb.classList.add("is-rippling");
    });
  }

  function renderTimer() {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    $("timer").textContent =
      String(minutes).padStart(2, "0") + ":" +
      String(remainingSeconds).padStart(2, "0");
  }

  function getNextUnfinishedStep(afterIndex = -1) {
    for (let offset = 1; offset <= currentPlan.length; offset++) {
      const index = (afterIndex + offset + currentPlan.length) % currentPlan.length;
      if (!completedSteps[index]) return index;
    }
    return -1;
  }

  function selectStep(index, restoreFocus = false) {
    if (!Number.isInteger(index) || index < 0 || index >= currentPlan.length) return;
    selectedStepIndex = index;
    renderPlan();
    if (restoreFocus) {
      const button = $("stepList").querySelector(`[data-step-select="${index}"]`);
      if (button) button.focus({ preventScroll: true });
    }
  }

  function completePlanStep(index, restoreFocus = false) {
    if (!Number.isInteger(index) || index < 0 || index >= currentPlan.length || completedSteps[index]) return;
    completedSteps[index] = true;
    const nextIndex = getNextUnfinishedStep(index);
    if (nextIndex >= 0) {
      selectedStepIndex = nextIndex;
      if (activeSession && activeSession.stepIndex === index) {
        activeSession.stepIndex = nextIndex;
        activeSession.firstStep = currentPlan[nextIndex][0];
        activeSession.instructions = currentPlan[nextIndex][1];
        saveFocusSession();
      }
    }
    renderPlan();
    if (activeSession) renderFocus();
    if (restoreFocus) {
      const focusTarget = nextIndex >= 0
        ? $("stepList").querySelector(`[data-step-select="${nextIndex}"]`)
        : document.querySelector(".steps-panel > summary");
      if (focusTarget) focusTarget.focus({ preventScroll: true });
    }
    pulseOrb();
  }

  function stopTimer() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function showToast(message) {
    $("toast").textContent = message;
    $("toast").classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("show"), 2400);
  }

  function startTimer() {
    if (timerId !== null || !activeSession || activeSession.recorded || seconds <= 0) return;

    paused = false;
    saveFocusSession();
    timerId = setInterval(() => {
      if (seconds <= 0) return;
      seconds--;
      renderTimer();
      saveFocusSession();

      if (seconds === 0) {
        stopTimer();
        renderFocus();
        showToast("Time is up. You gave this task your attention.");
      }
    }, 1000);
    renderFocus();
  }

  function stopRescueTimer() {
    if (rescueTimerId !== null) {
      clearInterval(rescueTimerId);
      rescueTimerId = null;
    }
  }

  function renderRescue() {
    const hasRescue = Boolean(rescueState);
    const completed = hasRescue && rescueState.completed;
    const expired = hasRescue && rescueSecondsLeft === 0 && !completed;

    $("rescueSession").hidden = !hasRescue;
    $("rescueStart").hidden = hasRescue && !completed && !expired;
    $("rescueSuccess").hidden = !completed;
    $("rescueAction").textContent = hasRescue
      ? rescueState.action
      : rescueActionFor($("taskType").value, barrier);
    $("rescueCountdown").textContent =
      "00:" + String(rescueSecondsLeft).padStart(2, "0");
    $("rescueCountdown").setAttribute(
      "aria-label",
      rescueSecondsLeft + (rescueSecondsLeft === 1 ? " second remaining" : " seconds remaining")
    );
    $("rescueStatus").textContent = completed
      ? "Done"
      : expired
        ? "Time's up — you can restart"
        : rescueTimerId !== null
          ? "Your 20 seconds"
          : "Paused";
    $("rescuePause").textContent = rescueTimerId !== null ? "Pause" : "Resume";
    $("rescuePause").disabled = completed || expired;
    $("rescueRestart").disabled = completed;
    $("rescueDone").disabled = completed;
  }

  function runRescueTimer() {
    if (rescueTimerId !== null || !rescueState || rescueState.completed || rescueSecondsLeft <= 0) return;

    rescueTimerId = setInterval(() => {
      if (rescueSecondsLeft <= 0) return;
      rescueSecondsLeft--;

      if (rescueSecondsLeft === 0) {
        stopRescueTimer();
        showToast("Time is up. No pressure—you can restart or stop here.");
      }

      renderRescue();
    }, 1000);
    renderRescue();
  }

  function startRescue() {
    if (!validateTaskInput()) return;

    if (
      rescueState &&
      !rescueState.completed &&
      rescueSecondsLeft > 0
    ) {
      return;
    }

    if (timerId !== null) {
      stopTimer();
      paused = true;
      renderFocus();
      saveFocusSession();
    }
    stopRescueTimer();
    rescueState = {
      action: `For “${currentPlan[selectedStepIndex][0]}”: ${rescueActionFor($("taskType").value, barrier)}`,
      task: task(),
      barrier,
      completed: false
    };
    rescueSecondsLeft = rescueSeconds;
    rescueProgress.attempts++;
    saveRescueProgress();
    $("heroOrb").classList.remove("is-rescue-success");
    $("rescueOrb").classList.remove("is-rescue-success");
    $("heroOrb").classList.add("is-rescuing");
    $("rescueOrb").classList.add("is-rescuing");
    pulseOrb();
    renderRescue();
    runRescueTimer();
  }

  function completeRescue() {
    if (!rescueState || rescueState.completed) return;

    stopRescueTimer();
    rescueState.completed = true;
    rescueSecondsLeft = 0;
    rescueProgress.completed++;
    rescueProgress.strategies[rescueState.barrier] =
      (rescueProgress.strategies[rescueState.barrier] || 0) + 1;
    saveRescueProgress();
    recordWin({
      task: rescueState.task,
      minutes: 0,
      duration: "20 sec",
      source: "rescue",
      barrier: rescueState.barrier
    });
    renderRescue();
    $("heroOrb").classList.remove("is-rescuing");
    $("rescueOrb").classList.remove("is-rescuing");
    $("heroOrb").classList.add("is-rescue-success");
    $("rescueOrb").classList.add("is-rescue-success");
    $("appRoot").classList.add("is-win-celebration");
    celebrateWorld();
    pulseOrb();
    setTimeout(() => {
      $("heroOrb").classList.remove("is-rescue-success");
      $("rescueOrb").classList.remove("is-rescue-success");
      $("appRoot").classList.remove("is-win-celebration");
    }, 1100);
    showToast("Tiny action done. That's a real win.");
  }

  function startSession() {
    if (activeSession && !activeSession.recorded) {
      const selectedStep = currentPlan[selectedStepIndex];
      const sameSessionTarget = selectedStep &&
        task() === activeSession.task &&
        selectedStep[0] === activeSession.firstStep;
      if (sameSessionTarget) {
        focusWasInterrupted = false;
        $("focusInterruptedNotice").hidden = true;
        if (rescueTimerId !== null) {
          stopRescueTimer();
          renderRescue();
        }
        $("worldScene").classList.add("is-focus-mode", "is-plan-active");
        $("appRoot").classList.add("is-focus-mode");
        if (seconds > 0) {
          if (timerId === null) {
            paused = false;
            startTimer();
            showToast("Focus session resumed.");
          }
          renderFocus();
        } else {
          finishSession();
        }
        showView("focus");
        return;
      }

      const shouldReplaceSession = window.confirm(
        `Start "${selectedStep[0]}" instead of resuming the paused step "${activeSession.firstStep}"? The paused session will be discarded.`
      );
      if (!shouldReplaceSession) return;
      stopTimer();
      activeSession = null;
      seconds = 0;
      paused = false;
      focusWasInterrupted = false;
      clearFocusSession();
    }

    if (!validateTaskInput()) return;
    planGenerated = true;
    renderPlan();
    if (completedSteps[selectedStepIndex]) {
      const nextStep = getNextUnfinishedStep(selectedStepIndex);
      if (nextStep >= 0) {
        selectedStepIndex = nextStep;
        renderPlan();
      }
    }
    if (selectedStepIndex < 0 || completedSteps[selectedStepIndex]) {
      showToast("Every step in this plan is complete.");
      return;
    }
    if (rescueTimerId !== null) {
      stopRescueTimer();
      renderRescue();
    }
    activeSession = {
      task: task(),
      firstStep: currentPlan[selectedStepIndex][0],
      instructions: currentPlan[selectedStepIndex][1],
      stepIndex: selectedStepIndex,
      minutes: Number($("minutes").value),
      recorded: false
    };
    recordWin({
      task: activeSession.task,
      minutes: activeSession.minutes,
      duration: "Started",
      source: "focus"
    });
    seconds = activeSession.minutes * 60;
    paused = false;
    focusWasInterrupted = false;
    $("focusInterruptedNotice").hidden = true;
    $("worldScene").classList.add("is-focus-mode", "is-plan-active");
    $("appRoot").classList.add("is-focus-mode");
    showView("focus");
    startTimer();
    showToast("Focus session started.");
  }

  function finishSession() {
    if (!activeSession || activeSession.recorded) return;

    const completedStepIndex = activeSession.stepIndex;
    stopTimer();
    seconds = 0;
    activeSession.recorded = true;
    if (completedStepIndex >= 0 && completedStepIndex < currentPlan.length && !completedSteps[completedStepIndex]) {
      completePlanStep(completedStepIndex);
    }
    focusWasInterrupted = false;
    $("focusInterruptedNotice").hidden = true;
    clearFocusSession();
    $("worldScene").classList.remove("is-focus-mode");
    $("appRoot").classList.remove("is-focus-mode");
    $("appRoot").classList.add("is-win-celebration");
    celebrateWorld();
    renderFocus();
    document.querySelector(".focus-content").classList.add("is-celebrating");
    setTimeout(() => {
      document.querySelector(".focus-content").classList.remove("is-celebrating");
      $("appRoot").classList.remove("is-win-celebration");
    }, 650);
    showToast("Focus session finished. Your starting win was already saved.");
  }

  function recordWin(win) {
    wins.unshift({
      ...win,
      completedAt: new Date().toISOString()
    });
    saveWins();
    renderWins();
    renderProgressDashboard();
  }

  function renderFocus() {
    const focusContent = document.querySelector(".focus-content");
    const hasSession = Boolean(activeSession);
    const recorded = hasSession && activeSession.recorded;
    const expired = hasSession && seconds === 0 && !recorded;

    focusContent.classList.toggle("is-complete", expired || recorded);
    focusContent.classList.toggle("is-running", timerId !== null);
    $("focusInterruptedNotice").hidden = !focusWasInterrupted;
    $("focusTask").textContent = hasSession
      ? activeSession.task
      : task();
    $("focusStepInstructions").textContent = hasSession
      ? (activeSession.instructions || currentPlan[activeSession.stepIndex]?.[1] || "")
      : currentPlan[selectedStepIndex][1];
    $("restartFocus").hidden = !hasSession || recorded;
    $("timerStatus").textContent = recorded
      ? "Session finished"
      : expired
        ? "Session complete"
        : !hasSession
          ? "Ready when you are"
          : paused
            ? "Paused"
            : timerId === null
              ? "Ready to focus"
              : "In progress";

    if (recorded) {
      $("focusTitle").textContent = "You showed up.";
      $("focusStepInstructions").textContent = "";
      $("focusPrompt").textContent = "You made space to begin. That counts as a win.";
      $("pauseBtn").textContent = "Back to My Plan";
      $("finishBtn").textContent = "See my wins";
      $("finishBtn").disabled = false;
    } else if (expired) {
      $("focusTitle").textContent = "You made space to begin.";
      $("focusPrompt").textContent = "You gave this task your attention. That's a meaningful start.";
      $("pauseBtn").textContent = "Back to My Plan";
      $("finishBtn").textContent = "Close session";
      $("finishBtn").disabled = false;
    } else if (!hasSession) {
      $("focusTitle").textContent = currentPlan[selectedStepIndex][0] + ".";
      $("focusPrompt").textContent = "You don't have to do it all. Just be here for this bit.";
      $("pauseBtn").textContent = "Start focus session";
      $("finishBtn").textContent = "Finish session";
      $("finishBtn").disabled = true;
    } else {
      $("focusTitle").textContent = activeSession.firstStep + ".";
      $("focusPrompt").textContent = "You don't have to do it all. Just be here for this bit.";
      $("pauseBtn").textContent = timerId !== null
        ? "Pause"
        : paused
          ? "Resume"
          : "Start focus session";
      $("finishBtn").textContent = "Finish session";
      $("finishBtn").disabled = false;
    }

    $("backToWorkspace").textContent = hasSession
      ? "← Close session and keep it paused"
      : "← Back to My Plan";
    renderTimer();
  }

  function loadWins() {
    try {
      const stored = window.localStorage.getItem(winsStorageKey);
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return [];

      return parsed.filter(item =>
        item &&
        typeof item.task === "string" &&
        typeof item.minutes === "number" &&
        Number.isFinite(item.minutes) &&
        typeof item.completedAt === "string"
      );
    } catch (error) {
      storageAvailable = false;
      return [];
    }
  }

  function loadRescueProgress() {
    try {
      const stored = window.localStorage.getItem(rescueStorageKey);
      if (!stored) return { attempts: 0, completed: 0, strategies: {} };
      const parsed = JSON.parse(stored);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { attempts: 0, completed: 0, strategies: {} };
      }

      const strategies = {};
      if (parsed.strategies && typeof parsed.strategies === "object") {
        ["start", "big", "energy", "fear", "distracted", "postponing"].forEach(key => {
          const count = parsed.strategies[key];
          if (Number.isInteger(count) && count > 0) strategies[key] = count;
        });
      }

      return {
        attempts: Number.isInteger(parsed.attempts) && parsed.attempts > 0 ? parsed.attempts : 0,
        completed: Number.isInteger(parsed.completed) && parsed.completed > 0 ? parsed.completed : 0,
        strategies
      };
    } catch (error) {
      storageAvailable = false;
      return { attempts: 0, completed: 0, strategies: {} };
    }
  }

  function saveWins() {
    try {
      window.localStorage.setItem(winsStorageKey, JSON.stringify(wins));
    } catch (error) {
      storageAvailable = false;
    }
  }

  function saveRescueProgress() {
    try {
      window.localStorage.setItem(rescueStorageKey, JSON.stringify(rescueProgress));
    } catch (error) {
      storageAvailable = false;
    }
  }

  function renderWins() {
    $("winCount").textContent = String(wins.length);
    $("totalSmallWins").textContent = String(wins.length);
    $("rescueAttemptCount").textContent = String(rescueProgress.attempts);
    $("rescueCompletedCount").textContent = String(rescueProgress.completed);
    $("strategyList").replaceChildren();
    const strategyNames = {
      start: "Finding a first step",
      big: "Choosing one small piece",
      energy: "Making the action easier",
      fear: "Trying an imperfect draft",
      distracted: "Quieting a distraction",
      postponing: "A 20-second start"
    };
    const helped = Object.entries(rescueProgress.strategies)
      .filter(([, count]) => count > 0)
      .sort((left, right) => right[1] - left[1]);
    $("strategyEmpty").hidden = helped.length > 0;

    helped.forEach(([key, count]) => {
      const chip = document.createElement("span");
      chip.className = "strategy-chip";
      chip.textContent = strategyNames[key] + " · " + count;
      $("strategyList").append(chip);
    });

    $("winsList").replaceChildren();
    $("emptyWins").hidden = wins.length > 0;

    wins.forEach(win => {
      const item = document.createElement("article");
      item.className = "win-item";

      const icon = document.createElement("span");
      icon.className = "win-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "✓";

      const details = document.createElement("div");
      details.className = "win-details";
      const title = document.createElement("strong");
      title.textContent = win.task;
      const date = document.createElement("span");
      const completedAt = new Date(win.completedAt);
      date.textContent = Number.isNaN(completedAt.getTime())
        ? "A small win"
        : completedAt.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
      details.append(title, date);

      const duration = document.createElement("span");
      duration.className = "win-duration";
      duration.textContent = win.duration ||
        (win.minutes + (win.minutes === 1 ? " min" : " mins"));
      item.append(icon, details, duration);
      $("winsList").append(item);
    });

    $("storageNote").hidden = storageAvailable;
  }

  function reset() {
    if (!window.confirm("Reset the current task and plan, including any active focus or rescue session? Your task list and small wins will be kept.")) {
      return;
    }

    stopTimer();
    stopRescueTimer();
    activeSession = null;
    focusWasInterrupted = false;
    clearFocusSession();
    rescueState = null;
    rescueSecondsLeft = rescueSeconds;
    paused = false;
    energy = defaults.energy;
    barrier = defaults.barrier;
    currentPlanKey = "";
    planGenerated = false;
    completedSteps = [];
    selectedStepIndex = 0;
    planWinRecorded = false;
    flowStage = "task";
    $("taskType").value = defaults.type;
    $("taskText").value = defaults.task;
    $("taskText").setAttribute("aria-invalid", "false");
    $("taskError").hidden = true;
    $("minutes").value = String(defaults.minutes);

    document.querySelectorAll("[data-energy]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.energy === energy));
    });
    document.querySelectorAll("[data-barrier]").forEach(button => {
      button.setAttribute("aria-checked", String(button.dataset.barrier === barrier));
      button.tabIndex = button.dataset.barrier === barrier ? 0 : -1;
    });

    update();
    renderRescue();
    $("heroOrb").classList.remove("is-rescuing", "is-rescue-success");
    $("rescueOrb").classList.remove("is-rescuing", "is-rescue-success");
    $("worldScene").classList.remove("is-focus-mode", "is-plan-active", "is-win-celebration");
    $("appRoot").classList.remove("is-focus-mode", "is-win-celebration");
    $("worldObjectNote").hidden = true;
    document.querySelectorAll(".world-crystal").forEach(crystal => {
      crystal.setAttribute("aria-pressed", "false");
    });
    showView("workspace");
    showToast("My Plan reset");
  }

  document.querySelectorAll("[data-nav]").forEach(link => {
    link.addEventListener("click", event => {
      if (link.tagName === "A") event.preventDefault();
      showView(link.dataset.nav);
    });
  });

  $("taskAddForm").addEventListener("submit", event => {
    event.preventDefault();
    const title = $("newTaskText").value.trim();
    if (!title) {
      $("taskListFeedback").textContent = "Add a task name before saving it.";
      $("newTaskText").focus();
      return;
    }
    tasks.unshift({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      title,
      completed: false
    });
    $("newTaskText").value = "";
    $("taskText").value = title;
    $("taskListFeedback").textContent = "Task added and selected. Continue to set your pace.";
    $("taskText").setAttribute("aria-invalid", "false");
    $("taskError").hidden = true;
    update();
    saveTasks();
    renderTaskList();
    renderProgressDashboard();
  });

  $("taskList").addEventListener("click", event => {
    const actionButton = event.target.closest("[data-task-action]");
    if (!actionButton) return;
    const card = actionButton.closest("[data-task-id]");
    const item = tasks.find(taskItem => taskItem.id === card.dataset.taskId);
    if (!item) return;

    if (actionButton.dataset.taskAction === "toggle") {
      item.completed = !item.completed;
      saveTasks();
      renderTaskList();
      renderProgressDashboard();
      showToast(item.completed ? "Task completed. Nicely done." : "Task reopened.");
    } else if (actionButton.dataset.taskAction === "delete") {
      tasks = tasks.filter(taskItem => taskItem.id !== item.id);
      saveTasks();
      renderTaskList();
      renderProgressDashboard();
      $("taskListFeedback").textContent = "Task removed from your list.";
    } else if (actionButton.dataset.taskAction === "plan") {
      $("taskText").value = item.title;
      $("taskText").setAttribute("aria-invalid", "false");
      $("taskError").hidden = true;
      flowStage = "setup";
      planGenerated = false;
      update();
      showView("workspace");
      showToast("Task selected. Set your pace to continue.");
    }
  });

  $("motionSetting").addEventListener("change", () => {
    reduceMotion = $("motionSetting").checked;
    document.documentElement.classList.toggle("user-reduced-motion", reduceMotion);
    saveSettings();
    renderSettings();
  });
  $("defaultMinutes").addEventListener("input", () => {
    defaults.minutes = Number($("defaultMinutes").value);
    $("defaultMinutesValue").textContent = `${defaults.minutes} minutes`;
    saveSettings();
  });
  $("defaultEnergy").addEventListener("change", () => {
    defaults.energy = $("defaultEnergy").value;
    saveSettings();
  });
  $("defaultBarrier").addEventListener("change", () => {
    defaults.barrier = $("defaultBarrier").value;
    saveSettings();
  });
  $("settingsReset").addEventListener("click", reset);

  function validateTaskInput() {
    const isValid = $("taskText").value.trim().length > 0;
    $("taskText").setAttribute("aria-invalid", String(!isValid));
    $("taskError").hidden = isValid;
    if (!isValid) {
      showView("workspace");
      $("taskText").focus();
    }
    return isValid;
  }

  const updatePlanFromInput = () => {
    const nextKey = JSON.stringify([
      $("taskType").value,
      energy,
      barrier,
      Number($("minutes").value),
      $("taskText").value.trim()
    ]);
    if (planGenerated && nextKey !== currentPlanKey) {
      if (activeSession && !activeSession.recorded) {
        stopTimer();
        activeSession = null;
        seconds = 0;
        paused = false;
        clearFocusSession();
      }
      stopRescueTimer();
      rescueState = null;
      planGenerated = false;
      planWinRecorded = false;
      flowStage = "setup";
      showToast("Plan settings changed. Previous step progress was cleared.");
    }
    if ($("taskText").value.trim()) {
      $("taskText").setAttribute("aria-invalid", "false");
      $("taskError").hidden = true;
    }
    update();
  };
  $("taskType").addEventListener("change", updatePlanFromInput);
  $("taskText").addEventListener("input", updatePlanFromInput);
  $("minutes").addEventListener("input", updatePlanFromInput);

  $("continueToSetup").addEventListener("click", () => {
    if (!validateTaskInput()) return;
    flowStage = "setup";
    update();
    $("minutes").focus();
  });
  $("backToTask").addEventListener("click", () => {
    flowStage = "task";
    renderWorkflowStage();
    $("taskText").focus();
  });
  $("generatePlan").addEventListener("click", () => {
    if (!validateTaskInput()) return;
    planGenerated = true;
    flowStage = "plan";
    $("worldScene").classList.add("is-plan-active");
    update();
    renderWorkflowStage();
    showToast("Your plan is ready.");
  });
  $("editPlan").addEventListener("click", () => {
    if (activeSession && !activeSession.recorded) {
      if (!window.confirm("Edit this plan and discard the paused focus session? Your task and completed steps will be kept until plan settings change.")) return;
      stopTimer();
      activeSession = null;
      seconds = Number($("minutes").value) * 60;
      paused = false;
      clearFocusSession();
    }
    flowStage = "setup";
    renderWorkflowStage();
    $("minutes").focus();
  });
  $("recordPlanWin").addEventListener("click", () => {
    if (planWinRecorded || !completedSteps.every(Boolean)) return;
    planWinRecorded = true;
    saveWorkspaceProgress();
    recordWin({
      task: task(),
      minutes: Number($("minutes").value),
      duration: "Plan complete",
      source: "plan"
    });
    $("recordPlanWin").textContent = "Small Win recorded";
    $("recordPlanWin").disabled = true;
    showToast("Your plan completion was saved as a Small Win.");
  });
  $("stopForNow").addEventListener("click", () => showView("home"));
  $("makeAnotherPlan").addEventListener("click", () => {
    if (activeSession && !activeSession.recorded) {
      stopTimer();
      activeSession = null;
      clearFocusSession();
    }
    completedSteps = currentPlan.map(() => false);
    selectedStepIndex = 0;
    planWinRecorded = false;
    planGenerated = false;
    currentPlanKey = "";
    flowStage = "setup";
    update();
    $("minutes").focus();
  });

  $("restartFocus").addEventListener("click", () => {
    if (!activeSession || activeSession.recorded) return;
    stopTimer();
    seconds = activeSession.minutes * 60;
    paused = false;
    startTimer();
    showToast("Focus timer restarted.");
  });

  document.querySelectorAll("[data-barrier]").forEach(button => {
    button.addEventListener("click", () => {
      barrier = button.dataset.barrier;
      document.querySelectorAll("[data-barrier]").forEach(item => {
        item.setAttribute("aria-checked", String(item === button));
        item.tabIndex = item === button ? 0 : -1;
      });
      currentPlanKey = "";
      update();
      renderRescue();
    });
  });
  $("barrierOptions").addEventListener("keydown", event => {
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    const options = [...document.querySelectorAll("[data-barrier]")];
    const currentIndex = options.indexOf(event.target);
    const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = (currentIndex + direction + options.length) % options.length;
    options[nextIndex].focus();
    options[nextIndex].click();
  });

  document.querySelectorAll("[data-energy]").forEach(button => {
    button.addEventListener("click", () => {
      energy = button.dataset.energy;
      document.querySelectorAll("[data-energy]").forEach(item => {
        item.setAttribute("aria-pressed", String(item === button));
      });
      update();
    });
  });

  $("startSession").addEventListener("click", startSession);
  $("stepStarted").addEventListener("click", () => completePlanStep(selectedStepIndex));
  $("rescueStart").addEventListener("click", startRescue);
  $("rescueDisclosure").addEventListener("toggle", event => {
    if (!event.currentTarget.open && rescueTimerId !== null) {
      stopRescueTimer();
      renderRescue();
    }
  });
  $("rescuePause").addEventListener("click", () => {
    if (!rescueState || rescueState.completed || rescueSecondsLeft <= 0) return;
    if (rescueTimerId !== null) {
      stopRescueTimer();
    } else {
      runRescueTimer();
    }
    renderRescue();
  });
  $("rescueRestart").addEventListener("click", () => {
    if (!rescueState || rescueState.completed) return;
    stopRescueTimer();
    rescueSecondsLeft = rescueSeconds;
    $("heroOrb").classList.add("is-rescuing");
    renderRescue();
    runRescueTimer();
  });
  $("rescueDone").addEventListener("click", completeRescue);

  $("pauseBtn").addEventListener("click", () => {
    if (activeSession && activeSession.recorded) {
      showView("workspace");
    } else if (activeSession && seconds === 0) {
      showView("workspace");
    } else if (timerId !== null) {
      stopTimer();
      paused = true;
      renderFocus();
      showToast("Focus session paused.");
    } else {
      startSession();
    }
  });

  $("finishBtn").addEventListener("click", () => {
    if (activeSession && activeSession.recorded) {
      showView("wins");
    } else if (activeSession && seconds === 0) {
      showView("workspace");
    } else {
      finishSession();
    }
  });

  $("backToWorkspace").addEventListener("click", () => {
    if (timerId !== null) {
      stopTimer();
      paused = true;
      renderFocus();
      saveFocusSession();
      showToast("Focus paused. Your remaining time is saved for this visit.");
    }
    $("worldScene").classList.remove("is-focus-mode");
    $("appRoot").classList.remove("is-focus-mode");
    if (planGenerated) flowStage = "plan";
    showView("workspace");
  });

  $("stepList").addEventListener("change", event => {
    if (!event.target.matches(".step-check")) return;
    const index = Number(event.target.dataset.stepComplete);
    if (event.target.checked) {
      completePlanStep(index, true);
    } else {
      completedSteps[index] = false;
      selectedStepIndex = index;
      renderPlan();
    }
  });

  $("stepList").addEventListener("click", event => {
    if (event.target.closest(".step-check")) return;
    const row = event.target.closest(".step[data-step-index]");
    if (!row) return;
    selectStep(Number(row.dataset.stepIndex), true);
  });

  $("stepList").addEventListener("keydown", event => {
    const button = event.target.closest("[data-step-select]");
    if (!button) return;
    let index = Number(button.dataset.stepSelect);
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      index = (index + 1) % currentPlan.length;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      index = (index - 1 + currentPlan.length) % currentPlan.length;
    } else if (event.key === "Home") {
      index = 0;
    } else if (event.key === "End") {
      index = currentPlan.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    selectStep(index, true);
  });

  document.querySelectorAll("[data-world-action]").forEach(crystal => {
    crystal.addEventListener("click", () => {
      const note = $("worldObjectNote");
      const alreadySelected = crystal.getAttribute("aria-pressed") === "true";
      document.querySelectorAll(".world-crystal").forEach(item => {
        item.setAttribute("aria-pressed", String(item === crystal && !alreadySelected));
      });

      if (alreadySelected) {
        note.hidden = true;
        return;
      }

      const checked = completedSteps.filter(Boolean).length;
      note.textContent = crystal.dataset.worldAction === "first-step"
        ? "Your next step: " + currentPlan[0][0] + ". Choose Start small to work on it."
        : `Your plan: ${checked} of ${currentPlan.length} steps complete. Check off steps in My Plan to light the path.`;
      note.hidden = false;
    });
  });

  document.querySelector(".hero-art").addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    $("worldObjectNote").hidden = true;
    document.querySelectorAll(".world-crystal").forEach(crystal => {
      crystal.setAttribute("aria-pressed", "false");
    });
  });

  $("copyPlan").addEventListener("click", async () => {
    if (!validateTaskInput()) return;
    const summary = [
      "My Unstuck plan",
      "Task: " + task(),
      "Selected step: " + currentPlan[selectedStepIndex][0],
      "Time available: " + $("minutes").value + " minutes",
      "Energy: " + energy,
      "Next steps:",
      ...currentPlan.map((step, index) =>
        `${index + 1}. ${step[0]} — ${step[1]}`
      ),
      "Reminder: starting counts; finishing everything is not required."
    ].join("\n");

    try {
      await navigator.clipboard.writeText(summary);
      showToast("Plan copied");
    } catch (error) {
      const textarea = document.createElement("textarea");
      textarea.value = summary;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      showToast(copied ? "Plan copied" : "Copy unavailable in this browser");
    }
  });

  if (
    window.matchMedia("(pointer: fine)").matches &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    const heroArt = document.querySelector(".hero-art");
    heroArt.addEventListener("pointermove", event => {
      const bounds = heroArt.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width - .5;
      const y = (event.clientY - bounds.top) / bounds.height - .5;
      $("heroOrb").style.setProperty("--pointer-x", (-y * 13).toFixed(2) + "deg");
      $("heroOrb").style.setProperty("--pointer-y", (x * 16).toFixed(2) + "deg");
    });
    heroArt.addEventListener("pointerleave", () => {
      $("heroOrb").style.setProperty("--pointer-x", "0deg");
      $("heroOrb").style.setProperty("--pointer-y", "0deg");
    });

    document.querySelectorAll("[data-tilt], .preview-card").forEach(card => {
      card.addEventListener("pointermove", event => {
        const bounds = card.getBoundingClientRect();
        const x = (event.clientX - bounds.left) / bounds.width - .5;
        const y = (event.clientY - bounds.top) / bounds.height - .5;
        const tiltX = (-y * 3.5).toFixed(2);
        const tiltY = (x * 3.5).toFixed(2);
        card.style.transform = card.classList.contains("preview-card")
          ? `perspective(900px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) rotateZ(-2deg)`
          : `perspective(900px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) translateZ(3px)`;
        card.classList.add("is-tilting");
      });
      card.addEventListener("pointerleave", () => {
        card.style.removeProperty("transform");
        card.classList.remove("is-tilting");
      });
    });
  }

  const savedSettings = loadSettings();
  defaults.minutes = savedSettings.minutes;
  defaults.energy = savedSettings.energy;
  defaults.barrier = savedSettings.barrier;
  reduceMotion = savedSettings.reduceMotion;
  const savedWorkspace = loadWorkspaceProgress();
  const interruptedFocus = loadFocusSession();
  tasks = loadTasks();
  document.documentElement.classList.toggle("user-reduced-motion", reduceMotion);
  $("taskType").value = savedWorkspace.type;
  $("taskText").value = savedWorkspace.taskText;
  $("minutes").value = String(savedWorkspace.minutes);
  energy = savedWorkspace.energy;
  barrier = savedWorkspace.barrier;
  completedSteps = savedWorkspace.completedSteps;
  selectedStepIndex = savedWorkspace.selectedStepIndex;
  planWinRecorded = savedWorkspace.planWinRecorded ||
    (completedSteps.length === 3 && completedSteps.every(Boolean));
  planGenerated = savedWorkspace.planGenerated || completedSteps.some(Boolean);
  flowStage = planGenerated
    ? (savedWorkspace.flowStage === "task" ? "plan" : savedWorkspace.flowStage)
    : savedWorkspace.flowStage;
  currentPlanKey = JSON.stringify([
    savedWorkspace.type,
    energy,
    barrier,
    savedWorkspace.minutes,
    $("taskText").value.trim()
  ]);
  currentPlan = makeSteps(savedWorkspace.type, energy, barrier, savedWorkspace.minutes);
  if (interruptedFocus) {
    activeSession = interruptedFocus.session;
    if (activeSession.stepIndex >= currentPlan.length) activeSession.stepIndex = 0;
    if (currentPlan[activeSession.stepIndex]) {
      activeSession.firstStep = currentPlan[activeSession.stepIndex][0];
      activeSession.instructions = currentPlan[activeSession.stepIndex][1];
    }
    seconds = interruptedFocus.seconds;
    paused = true;
    focusWasInterrupted = true;
    $("taskText").value = activeSession.task;
  }
  document.querySelectorAll("[data-energy]").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.energy === energy));
  });
  document.querySelectorAll("[data-barrier]").forEach(button => {
    button.setAttribute("aria-checked", String(button.dataset.barrier === barrier));
    button.tabIndex = button.dataset.barrier === barrier ? 0 : -1;
  });

  wins = loadWins();
  rescueProgress = loadRescueProgress();
  update();
  renderTaskList();
  renderWins();
  renderProgressDashboard();
  renderSettings();
  renderRescue();
  showView("home");
  if (focusWasInterrupted) {
    showToast("An unfinished focus session is paused in this tab. Resume whenever you're ready.");
  }
})();
