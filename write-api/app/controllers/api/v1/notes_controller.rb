module Api
  module V1
    # Writes only. Reads go to the Go read-api: GET /api/v1/notes.
    class NotesController < ApplicationController
      def create
        authorize Note
        note = Note.new(note_params.merge(author_sub: current_user_sub))
        return render_errors(note) unless note.save

        render json: { id: note.id, note: note }, status: :created
      end

      def update
        note = Note.find(params[:id])
        authorize note
        return render_errors(note) unless note.update(note_params)

        render json: { id: note.id, note: note }
      end

      def destroy
        note = Note.find(params[:id])
        authorize note
        note.destroy!

        render json: { id: note.id }
      end

      private
        def note_params
          params.expect(note: %i[title body])
        end
    end
  end
end
