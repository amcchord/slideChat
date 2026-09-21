"""Bounded clarification replies. Buttons submit text; they never execute changes."""

from .sources import SourceError


def clarification_context(conversation, message):
    """Carry only the user's task and answers across a client-scope restart."""
    history = conversation.get("messages", [])
    previous = history[-1] if history else {}
    if (
        previous.get("role") == "assistant"
        and previous.get("choices")
        and previous.get("reply_context")
    ):
        context = (
            previous["reply_context"]
            + "\n\nClarification question: "
            + previous.get("content", "")[:300]
            + "\nUser answer: "
            + message
        )
        if len(context) > 16000:
            context = (
                context[:8000]
                + "\n[Earlier clarification text shortened]\n"
                + context[-7500:]
            )
        return context
    return message


def question_choices(arguments, clients):
    if not isinstance(arguments, dict) or set(arguments) != {"question", "choices"}:
        raise SourceError("Supply one question and its choices.")
    question = arguments["question"]
    choices = arguments["choices"]
    if not isinstance(question, str) or not 1 <= len(question.strip()) <= 300:
        raise SourceError("Ask a short clarification question.")
    if not isinstance(choices, list) or not 2 <= len(choices) <= 8:
        raise SourceError("Supply between two and eight choices.")
    allowed = {c["client_id"]: c for c in clients}
    result, seen = [], set()
    for choice in choices:
        if not isinstance(choice, dict) or set(choice) != {"label", "client_id"}:
            raise SourceError("Each choice needs a label and client_id.")
        label, client_id = choice["label"], choice["client_id"]
        if not isinstance(label, str) or not 1 <= len(label.strip()) <= 100:
            raise SourceError("Keep each answer label under 100 characters.")
        if not isinstance(client_id, str) or (client_id and client_id not in allowed):
            raise SourceError("Choose only clients in the current scope.")
        # A model cannot disguise a scope change under an unrelated label.
        label = (
            (allowed[client_id].get("name") or client_id)
            if client_id
            else label.strip()
        )
        identity = client_id or label.casefold()
        if identity in seen:
            raise SourceError("Choices must be distinct.")
        seen.add(identity)
        result.append({"label": label, "client_id": client_id})
    return question.strip(), result
